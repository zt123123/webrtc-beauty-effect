const fullscreenTexturedQuadWGSL = `
@group(0) @binding(0) var mySampler : sampler;
@group(0) @binding(2) var myTexture : texture_external;

struct VertexOutput {
  @builtin(position) Position : vec4f,
  @location(0) fragUV : vec2f,
}

@vertex
fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
  const pos = array(
    vec2( 1.0,  1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0, -1.0),
    vec2( 1.0,  1.0),
    vec2(-1.0, -1.0),
    vec2(-1.0,  1.0),
  );

  const uv = array(
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0),
    vec2(1.0, 0.0),
    vec2(0.0, 1.0),
    vec2(0.0, 0.0),
  );

  var output : VertexOutput;
  output.Position = vec4(pos[VertexIndex], 0.0, 1.0);
  output.fragUV = uv[VertexIndex];
  return output;
}

@fragment
fn frag_main(@location(0) fragUV : vec2f) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(myTexture, mySampler, fragUV);
}
`

const bilateralFilterWGSL = `
@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var myTexture: texture_external;

const KERNEL_SIZE = 5;
const SIGMA_SPATIAL = 4.0;
const SIGMA_RANGE = 0.2;
const MIX_FACTOR = 0.7;

fn gaussian(x: f32, sigma: f32) -> f32 {
  return exp(-(x * x) / (2.0 * sigma * sigma));
}

@fragment
fn main(@location(0) fragUV : vec2f) -> @location(0) vec4f {
  let originalColor = textureSampleBaseClampToEdge(myTexture, mySampler, fragUV).rgb;
  let centerColor = originalColor;
  var sumWeights = 0.0;
  var sumColor = vec3f(0.0);
  
  for (var i = -KERNEL_SIZE; i <= KERNEL_SIZE; i++) {
    for (var j = -KERNEL_SIZE; j <= KERNEL_SIZE; j++) {
      let offset = vec2f(f32(i), f32(j)) * 0.005;
      let sampleUV = fragUV + offset;
      let sampleColor = textureSampleBaseClampToEdge(myTexture, mySampler, sampleUV).rgb;
      
      let spatialDist = length(offset);
      let rangeDist = length(sampleColor - centerColor);
      
      let spatialWeight = gaussian(spatialDist, SIGMA_SPATIAL);
      let rangeWeight = gaussian(rangeDist, SIGMA_RANGE);
      let weight = spatialWeight * rangeWeight;
      
      sumColor += sampleColor * weight;
      sumWeights += weight;
    }
  }
  
  let smoothedColor = sumColor / sumWeights;
  let finalColor = mix(originalColor, smoothedColor, MIX_FACTOR);
  
  return vec4f(finalColor, 1.0);
}
`
const VIDEO_WIDTH = 1280
const VIDEO_HEIGHT = 720

async function init() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();

  // Set video element
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT
    }
  })

  const canvas = document.getElementById('canvas');
  const context = canvas.getContext('webgpu');
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  document.body.appendChild(canvas)

  const video = document.querySelector('.ovideo');
  const renderVideo = document.querySelector('.video');
  renderVideo.muted = true
  renderVideo.autoplay = true
  video.videoWidth = VIDEO_WIDTH
  video.videoHeight = VIDEO_HEIGHT
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  video.muted = true;
  video.srcObject = stream;
  await video.play();

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const renderStream = canvas.captureStream(30)
  renderVideo.srcObject = renderStream
  renderVideo.play()

  context.configure({
    device,
    format: presentationFormat,
  });

  // Create intermediate texture
  const texture = device.createTexture({
    size: [canvas.width / 2, canvas.height / 2],
    format: presentationFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC,
  });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({
        code: fullscreenTexturedQuadWGSL,
      }),
    },
    fragment: {
      module: device.createShaderModule({
        code: bilateralFilterWGSL,
      }),
      targets: [
        {
          format: presentationFormat,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  const params = new URLSearchParams(window.location.search);
  const settings = {
    requestFrame: 'requestAnimationFrame',
    videoSource: params.get('videoSource') || 'videoElement',
  };

  function frame() {
    const externalTextureSource =
      settings.videoSource === 'videoFrame' ? new VideoFrame(video) : video;

    // First pass: Apply bilateral filter to intermediate texture
    const firstPassBindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: sampler,
        },
        {
          binding: 1,
          resource: device.importExternalTexture({
            source: externalTextureSource,
          }),
        },
      ],
    });

    const commandEncoder = device.createCommandEncoder();

    // Render to intermediate texture
    const firstPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    firstPass.setPipeline(pipeline);
    firstPass.setBindGroup(0, firstPassBindGroup);
    firstPass.draw(6);
    firstPass.end();

    // Second pass: Render to canvas
    const textureView = context.getCurrentTexture().createView();
    const finalPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: [0, 0, 0, 1],
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    finalPass.setPipeline(pipeline);
    finalPass.setBindGroup(0, firstPassBindGroup);
    finalPass.draw(6);
    finalPass.end();

    device.queue.submit([commandEncoder.finish()]);

    if (externalTextureSource instanceof VideoFrame) {
      externalTextureSource.close();
    }

    if (settings.requestFrame == 'requestVideoFrameCallback') {
      video.requestVideoFrameCallback(frame);
    } else {
      requestAnimationFrame(frame);
    }
  }

  if (settings.requestFrame == 'requestVideoFrameCallback') {
    video.requestVideoFrameCallback(frame);
  } else {
    requestAnimationFrame(frame);
  }
}

init()