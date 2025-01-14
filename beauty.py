#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import cv2
import asyncio
import websockets
import numpy as np
import zlib
import time

async def video_stream(websocket):
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        await websocket.send("ERROR: Could not open camera")
        return

    try:
        # 获取摄像头原生分辨率
        origin_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        origin_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        # 缩小分辨率用于处理
        width = origin_width // 2
        height = origin_height // 2

        # 发送分辨率信息
        await websocket.send(f"RES:{width}:{height}".encode())

        frame_counter = 0
        last_frame_time = time.time()
        target_frame_time = 1/30  # 30 FPS

        while True:
            start_time = time.time()
            
            # 读取帧
            ret, frame = cap.read()
            if not ret:
                break

            # 跳过部分帧以提高性能
            frame_counter += 1
            if frame_counter % 2 != 0:
                continue

            # 缩小帧尺寸进行处理
            small_frame = cv2.resize(frame, (width, height))

            # 应用磨皮效果
            smoothed_frame = cv2.bilateralFilter(small_frame, d=9, sigmaColor=75, sigmaSpace=75)

            # 将处理后的帧还原为原始分辨率
            final_frame = cv2.resize(smoothed_frame, (origin_width, origin_height), 
                                   interpolation=cv2.INTER_LANCZOS4)

            # 将BGR转换为RGBA
            rgba_frame = cv2.cvtColor(smoothed_frame, cv2.COLOR_BGR2RGBA)

            # 压缩数据（使用更高效的压缩级别）
            compressed_data = zlib.compress(rgba_frame.tobytes(), level=9)

            # 发送压缩数据
            try:
                await websocket.send(compressed_data)
            except:
                break

            # 控制帧率
            process_time = time.time() - start_time
            sleep_time = max(0, target_frame_time - process_time)
            await asyncio.sleep(sleep_time)

    finally:
        cap.release()

async def main():
    async with websockets.serve(video_stream, "localhost", 8765):
        await asyncio.Future()  # 保持服务器运行

if __name__ == "__main__":
    asyncio.run(main())
    asyncio.run(main())
