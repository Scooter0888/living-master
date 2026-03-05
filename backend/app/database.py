from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import os


def _make_engine():
    from app.config import get_settings
    db_path = get_settings().db_path
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    return create_async_engine(f"sqlite+aiosqlite:///{db_path}", echo=False)


engine = _make_engine()
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
