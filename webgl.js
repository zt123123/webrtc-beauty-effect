// import { vertexShaderStr, fragmentShaderStr } from './shader';

const videoWidth = 1280;
const videoHeight = 720;

const vertexShaderStr = `
attribute vec4 a_Position;
attribute vec2 a_TexCoord;
varying vec2 v_TexCoord;
void main() {
    gl_Position = a_Position;
    v_TexCoord = a_TexCoord;
}
`


const fragmentShaderStr = `
precision highp float;
uniform sampler2D u_Sampler;
varying vec2 v_TexCoord;

uniform float u_SmoothIntensity;
uniform float u_WhitenIntensity;
uniform float u_RosyIntensity;
uniform float u_SharpenIntensity;

const float PI = 3.14159265359;
const float SIGMA_SPACE = 3.0;
const float SIGMA_COLOR = 0.18;
const int KERNEL_RADIUS = 5;

// 计算亮度
float getLuminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
}

// 改进的边缘检测
float getEdgeIntensity(sampler2D tex, vec2 uv) {
    vec2 texelSize = 1.0 / vec2(${videoWidth}.0, ${videoHeight}.0);
    vec3 center = texture2D(tex, uv).rgb;
    
    vec3 top = texture2D(tex, uv + vec2(0.0, texelSize.y)).rgb;
    vec3 bottom = texture2D(tex, uv - vec2(0.0, texelSize.y)).rgb;
    vec3 left = texture2D(tex, uv - vec2(texelSize.x, 0.0)).rgb;
    vec3 right = texture2D(tex, uv + vec2(texelSize.x, 0.0)).rgb;
    
    float dx = length(right - left);
    float dy = length(top - bottom);
    
    return sqrt(dx * dx + dy * dy);
}

float getSkinWeight(vec4 color) {
    float r = color.r;
    float g = color.g;
    float b = color.b;
    
    bool isSkin = r > 0.35 && g > 0.2 && b > 0.15
                  && r > g && g > b
                  && r - g > 0.07
                  && (r - b) > 0.1;
    
    return isSkin ? 1.0 : 0.3;
}

float gaussianWeight(float x, float sigma) {
    return (1.0 / sqrt(2.0 * PI * sigma * sigma)) * exp(-(x * x) / (2.0 * sigma * sigma));
}

// 调整参数映射函数
float adjustStrength(float rawStrength) {
    return (rawStrength / 50.0);
}

// 改进的磨皮强度映射
float adjustSmoothStrength(float rawStrength) {
    // 添加非线性映射来限制最大效果
    float normalized = rawStrength / 100.0;
    // 使用平方根函数来减缓强度增长
    float smoothed = sqrt(normalized) * 0.7;
    // 添加基础强度，但降低基础值
    return smoothed + 0.2;
}

// 改进的边缘检测权重计算
float getEdgeWeight(float edgeIntensity, float smoothStrength) {
    // 随着磨皮强度增加，提高边缘保护
    float threshold = mix(0.12, 0.2, smoothStrength);
    // 确保边缘始终得到保护
    return 1.0 - smoothstep(0.0, threshold, edgeIntensity);
}

vec4 bilateralFilter(sampler2D tex, vec2 uv) {
    vec2 texelSize = 1.0 / vec2(${videoWidth}.0, ${videoHeight}.0);
    vec4 centerColor = texture2D(tex, uv);
    
    if (u_SmoothIntensity <= 0.0) {
        return centerColor;
    }

    float edgeIntensity = getEdgeIntensity(tex, uv);
    float normalizedStrength = adjustSmoothStrength(u_SmoothIntensity);
    
    // 使用改进的边缘权重计算
    float edgeWeight = getEdgeWeight(edgeIntensity, normalizedStrength);
    
    vec4 result = vec4(0.0);
    float weightSum = 0.0;
    
    // 调整参数计算方式，限制最大值
    float sigmaSpace = SIGMA_SPACE * (1.0 + normalizedStrength * 0.6);
    float sigmaColor = SIGMA_COLOR * (1.0 + normalizedStrength * 0.6);
    
    float skinWeight = getSkinWeight(centerColor);
    // 降低非肤色区域的磨皮强度
    skinWeight = mix(0.3, 1.0, skinWeight);

    for(int i = -KERNEL_RADIUS; i <= KERNEL_RADIUS; i++) {
        for(int j = -KERNEL_RADIUS; j <= KERNEL_RADIUS; j++) {
            vec2 offset = vec2(float(i), float(j)) * texelSize;
            vec2 sampleUV = uv + offset;
            vec4 sampleColor = texture2D(tex, sampleUV);

            float spaceWeight = gaussianWeight(length(offset), sigmaSpace);
            float colorDist = length(centerColor - sampleColor);
            float colorWeight = gaussianWeight(colorDist, sigmaColor);

            // 增强边缘保护
            float weight = spaceWeight * colorWeight * skinWeight * (edgeWeight * 0.95 + 0.05);
            result += sampleColor * weight;
            weightSum += weight;
        }
    }

    vec4 smoothResult = result / weightSum;
    
    // 调整最终混合强度，确保保留足够的细节
    float finalMixStrength = normalizedStrength * 0.75;
    
    // 在高强度时保留更多细节
    if (normalizedStrength > 0.7) {
        float detailPreservation = 1.0 - (normalizedStrength - 0.7) * 2.0;
        finalMixStrength *= detailPreservation;
    }
    
    return mix(centerColor, smoothResult, finalMixStrength);
}

void main() {
    vec4 originalColor = texture2D(u_Sampler, v_TexCoord);
    
    // 1. 磨皮效果
    vec4 smoothColor = bilateralFilter(u_Sampler, v_TexCoord);
    float smoothStrength = adjustSmoothStrength(u_SmoothIntensity);
    
    // 调整最终混合，确保细节保留
    float finalSmoothStrength = smoothStrength * 0.75;
    vec4 blendedColor = mix(originalColor, smoothColor, finalSmoothStrength);
    
    // 在高强度磨皮时添加微量锐化以保持特征
    if (smoothStrength > 0.7 && u_SharpenIntensity <= 0.0) {
        vec4 highPassColor = originalColor - smoothColor;
        float autoSharpen = (smoothStrength - 0.7) * 0.3;
        blendedColor += highPassColor * autoSharpen;
    }
    
    // 2. 美白效果 - 保持原有映射
    vec4 whitenColor = blendedColor;
    if (u_WhitenIntensity > 0.0) {
        float whitenStrength = adjustStrength(u_WhitenIntensity);
        whitenColor = blendedColor * (1.0 + whitenStrength * 0.2);
        
        float luminance = getLuminance(whitenColor.rgb);
        whitenColor = mix(whitenColor, 
                        whitenColor * (1.0 + luminance * 0.1), 
                        whitenStrength * 0.6);
    }
    
    // 3. 红润效果 - 保持原有映射
    vec4 rosyColor = whitenColor;
    if (u_RosyIntensity > 0.0) {
        float rosyStrength = adjustStrength(u_RosyIntensity);
        float skinWeight = getSkinWeight(whitenColor);
        
        vec4 rosyTint = vec4(1.08, 0.95, 0.95, 1.0);
        float finalRosyStrength = rosyStrength * 0.35 * skinWeight;
        
        rosyColor = mix(whitenColor, 
                      whitenColor * rosyTint, 
                      finalRosyStrength);
        
        rosyColor.r = mix(rosyColor.r,
                        rosyColor.r * 1.06,
                        finalRosyStrength);
    }
    
    // 4. 锐化效果 - 保持原有映射
    vec4 finalColor = rosyColor;
    if (u_SharpenIntensity > 0.0) {
        float sharpenStrength = adjustStrength(u_SharpenIntensity);
        vec4 highPassColor = originalColor - smoothColor;
        
        finalColor = rosyColor + highPassColor * (sharpenStrength * 0.8);
        float detailEnhance = length(highPassColor.rgb) * sharpenStrength * 0.2;
        finalColor += vec4(detailEnhance);
    }
    
    gl_FragColor = clamp(finalColor, 0.0, 1.0);
}
`



class BeautyFilter {
    constructor(options) {
        // 添加美颜参数
        this.beautyParams = {
            smoothIntensity: 50,
            whitenIntensity: 50,
            rosyIntensity: 50,
            sharpenIntensity: 50,
            ...options,
        };

        this.video = document.getElementById('video');
        this.canvas = document.createElement('canvas');
        document.body.appendChild(this.canvas);
        this.gl = this.canvas.getContext('webgl');

        // 设置画布尺寸
        this.canvas.width = videoWidth;
        this.canvas.height = videoHeight;
    }

    setBeautyParams(params) {
        this.beautyParams = {
            ...this.beautyParams,
            ...params,
        }
        Object.entries(this.beautyParams).forEach(item => {
            const [key, value] = item;
            this.gl.uniform1f(uniformLocations[key.replace('Intensity', '')], value);
        })
    }

    async init() {
        try {
            // 获取摄像头流
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: videoWidth,
                    height: videoHeight
                }
            });

            // 初始化WebGL
            this.initShaders();
            this.initBuffers();

            // 创建MediaStream
            const processedStream = this.canvas.captureStream();
            this.video.srcObject = processedStream;

            // 将原始视频流连接到隐藏的video元素
            const gl = this.gl;

            const hiddenVideo = document.createElement('video');
            hiddenVideo.srcObject = stream;
            hiddenVideo.autoplay = true;
            hiddenVideo.playsinline = true;

            hiddenVideo.onplay = () => {
                // 开始渲染循环
                const render = () => {
                    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

                    // 创建并绑定纹理
                    const texture = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, texture);

                    // 设置纹理参数
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

                    // 将视频帧传入纹理
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, hiddenVideo);

                    // 绘制
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

                    requestAnimationFrame(render);
                }
                render();
            };
        } catch (error) {
            console.error('获取摄像头失败:', error);
        }
    }


    initShaders() {
        const gl = this.gl;
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

        gl.shaderSource(vertexShader, vertexShaderStr);
        gl.shaderSource(fragmentShader, fragmentShaderStr);

        gl.compileShader(vertexShader);
        gl.compileShader(fragmentShader);

        // 检查着色器编译状态
        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            console.error('顶点着色器编译失败:', gl.getShaderInfoLog(vertexShader));
            return;
        }
        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            console.error('片元着色器编译失败:', gl.getShaderInfoLog(fragmentShader));
            return;
        }

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        // 检查程序链接状态
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('程序链接失败:', gl.getProgramInfoLog(program));
            return;
        }

        gl.useProgram(program);
        window.program = program;

        // 获取uniform变量位置
        const uniformLocations = {
            smooth: gl.getUniformLocation(program, 'u_SmoothIntensity'),
            whiten: gl.getUniformLocation(program, 'u_WhitenIntensity'),
            rosy: gl.getUniformLocation(program, 'u_RosyIntensity'),
            sharpen: gl.getUniformLocation(program, 'u_SharpenIntensity')
        };

        const beautyParams = this.beautyParams;
        // 设置初始值
        gl.uniform1f(uniformLocations.smooth, beautyParams.smoothIntensity);
        gl.uniform1f(uniformLocations.whiten, beautyParams.whitenIntensity);
        gl.uniform1f(uniformLocations.rosy, beautyParams.rosyIntensity);
        gl.uniform1f(uniformLocations.sharpen, beautyParams.sharpenIntensity);

        window.uniformLocations = uniformLocations;
    }


    initBuffers() {
        // 顶点坐标
        const vertices = new Float32Array([
            -1.0, 1.0,
            -1.0, -1.0,
            1.0, 1.0,
            1.0, -1.0
        ]);

        // 纹理坐标
        const texCoords = new Float32Array([
            0.0, 0.0,
            0.0, 1.0,
            1.0, 0.0,
            1.0, 1.0
        ]);

        const gl = this.gl;

        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const a_Position = gl.getAttribLocation(program, 'a_Position');
        gl.vertexAttribPointer(a_Position, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(a_Position);

        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        const a_TexCoord = gl.getAttribLocation(program, 'a_TexCoord');
        gl.vertexAttribPointer(a_TexCoord, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(a_TexCoord);
    }
}