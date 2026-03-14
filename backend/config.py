"""
FlowMate-Echo 配置管理
"""

import os
from pathlib import Path
from dotenv import load_dotenv
from pydantic import BaseModel

# 加载环境变量
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)


class Settings(BaseModel):
    """应用配置"""

    # ModelScope Token
    MODELSCOPE_TOKEN: str = os.getenv("MODELSCOPE_TOKEN", "")

    # DashScope API Key (fallback to DASHSCOPE_KEY for legacy .env)
    DASHSCOPE_API_KEY: str = os.getenv("DASHSCOPE_API_KEY") or os.getenv("DASHSCOPE_KEY", "")

    # 服务配置
    BACKEND_HOST: str = os.getenv("BACKEND_HOST", "127.0.0.1")
    BACKEND_PORT: int = int(os.getenv("BACKEND_PORT", "8000"))

    # 模型配置
    QWEN_VL_MODEL: str = os.getenv("QWEN_VL_MODEL", "qwen-vl-plus")
    QWEN_MAX_MODEL: str = os.getenv("QWEN_MAX_MODEL", "qwen-max")
    QWEN_LIGHT_MODEL: str = os.getenv("QWEN_LIGHT_MODEL", "qwen-plus")
    QWEN_USE_ROUTING: bool = os.getenv("QWEN_USE_ROUTING", "true").lower() == "true"
    QWEN_TEXT_CHAT_USE_LIGHT: bool = (
        os.getenv("QWEN_TEXT_CHAT_USE_LIGHT", "true").lower() == "true"
    )
    QWEN_TEXT_CHAT_MODEL: str = os.getenv("QWEN_TEXT_CHAT_MODEL", "qwen-flash")
    QWEN_TEXT_CHAT_USE_FLASH: bool = (
        os.getenv("QWEN_TEXT_CHAT_USE_FLASH", "true").lower() == "true"
    )
    COSYVOICE_MODEL: str = os.getenv("COSYVOICE_MODEL", "iic/CosyVoice-300M-SFT")
    SENSEVOICE_MODEL: str = os.getenv("SENSEVOICE_MODEL", "sensevoice-v1")
    SENSEVOICE_SAMPLE_RATE: int = int(os.getenv("SENSEVOICE_SAMPLE_RATE", "16000"))
    SENSEVOICE_AUDIO_FORMAT: str = os.getenv("SENSEVOICE_AUDIO_FORMAT", "wav")
    SENSEVOICE_TIMEOUT_SECONDS: int = int(os.getenv("SENSEVOICE_TIMEOUT_SECONDS", "20"))

    # 功能开关
    ENABLE_CAMERA: bool = os.getenv("ENABLE_CAMERA", "true").lower() == "true"
    ENABLE_KEYBOARD_HOOK: bool = os.getenv("ENABLE_KEYBOARD_HOOK", "true").lower() == "true"
    DEBUG_MODE: bool = os.getenv("DEBUG_MODE", "false").lower() == "true"

    # 路径配置
    BASE_DIR: Path = Path(__file__).parent
    CACHE_DIR: Path = BASE_DIR / "cache"
    AUDIO_CACHE_DIR: Path = CACHE_DIR / "audio"

    class Config:
        env_file = ".env"


# 全局配置实例
settings = Settings()

# 确保缓存目录存在
settings.CACHE_DIR.mkdir(exist_ok=True)
settings.AUDIO_CACHE_DIR.mkdir(exist_ok=True)
