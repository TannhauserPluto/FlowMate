"""
FlowMate-Echo 后端服务
FastAPI 入口文件
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from config import settings
from api import perception, interaction

# 创建 FastAPI 应用
app = FastAPI(
    title="FlowMate-Echo Backend",
    description="AI 陪伴式心流助手后端服务",
    version="1.0.0",
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(perception.router, prefix="/api/perception", tags=["感知"])
app.include_router(interaction.router, prefix="/api/interaction", tags=["交互"])


@app.get("/")
async def root():
    """健康检查"""
    return {
        "status": "running",
        "service": "FlowMate-Echo Backend",
        "version": "1.0.0",
    }


@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "healthy"}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.BACKEND_HOST,
        port=settings.BACKEND_PORT,
        reload=settings.DEBUG_MODE,
    )
