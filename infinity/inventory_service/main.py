#inventory_service.py
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import os


load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

app = FastAPI(
    title="Ingredient Service API",
    description="Service untuk mengelola bahan-bahan Infinity Cafe.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mcp = FastApiMCP(app, name="Server MCP Infinity", description="Server MCP Infinity Descr",
    include_operations=["add ingredient", "list ingredients", "update ingredient", "delete ingredient", "ingredient status", "ingredient stream"]
)
mcp.mount(mount_path="/mcp", transport="sse")

# subscribers = set()

class Ingredient(Base):
    __tablename__ = "ingredients"
    ingredient_id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    quantity = Column(Integer, nullable=False)
    