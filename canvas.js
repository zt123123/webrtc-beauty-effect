// 使用canvas实现rtc美颜
async function applyBeautyFilter(stream) {
    const video = document.createElement('video'); // 创建一个video元素
    // document.body.appendChild(video)
    video.srcObject = stream; // 将流设置为video源
    video.muted = true
    await video.play()

    const canvas = document.createElement('canvas'); // 创建一个新的canvas元素
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.style.marginTop = '100px'
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d');

    function draw() {
        if (canvas.width > 0 && canvas.height > 0) { // 确保canvas的宽高有效
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // 遍历每个像素，应用美颜效果
            for (let i = 0; i < data.length; i += 4) {
                const whiteningFactor = 1.5; // 美白因子
                data[i] = Math.min(data[i] * whiteningFactor, 255);     // 红色通道
                data[i + 1] = Math.min(data[i + 1] * whiteningFactor, 255); // 绿色通道
                data[i + 2] = Math.min(data[i + 2] * whiteningFactor, 255); //
            }

            ctx.putImageData(imageData, 0, 0);
        }
        requestAnimationFrame(draw); // 使用requestAnimationFrame进行循环调用
    }

    draw(); // 开始绘制

    const canvasStream = canvas.captureStream(30); // 捕获流，30fps

    return canvasStream
}

// ... 其他代码 ...