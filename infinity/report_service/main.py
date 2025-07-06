from fastapi import FastAPI, Query, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, DateTime, func, Text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import os
import socket
import logging
from dotenv import load_dotenv

# Load environment
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

# Database setup
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

# FastAPI app
app = FastAPI(
    title="Infinity Cafe API",
    description="Layanan backend untuk laporan penjualan dan menu usulan",
    version="1.0.0",
    contact={"name": "Infinity Developer", "email": "dev@infinitycafe.com"}
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== MODELS ==========
class MenuSuggestion(Base):
    __tablename__ = "menu_suggestions"
    usulan_id = Column(String, primary_key=True)
    menu_name = Column(String, nullable=False)
    customer_name = Column(String, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=datetime.utcnow)

class OrderItem(Base):
    __tablename__ = "order_items"
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String)
    menu_name = Column(String, nullable=False)
    quantity = Column(Integer, default=1)
    unit_price = Column(Integer)
    customer_name = Column(String)
    preference = Column(Text)
    timestamp = Column(DateTime(timezone=True), default=datetime.utcnow)

class KitchenOrder(Base):
    __tablename__ = "kitchen_orders"
    order_id = Column(String, primary_key=True)
    status = Column(String)

# Create tables
Base.metadata.create_all(bind=engine)

# ========== DEPENDENCIES ==========
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ========== SCHEMAS ==========
class SuggestionIn(BaseModel):
    menu_name: str
    customer_name: Optional[str] = None

# ========== ENDPOINTS ==========
@app.get("/health", tags=["Utility"])
def health_check():
    return {"status": "ok"}

@app.post("/menu_suggestion", tags=["Menu Usulan"])
def submit_suggestion(suggestion: SuggestionIn, db: Session = Depends(get_db)):
    try:
        new_item = MenuSuggestion(
            usulan_id=f"US{int(datetime.utcnow().timestamp()*1_000_000)}",
            menu_name=suggestion.menu_name,
            customer_name=suggestion.customer_name
        )
        db.add(new_item)
        db.commit()
        db.refresh(new_item)
        return {"message": "Usulan berhasil disimpan", "id": new_item.usulan_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal menyimpan usulan: {str(e)}")

@app.get("/report/suggested_menu", tags=["Report"])
def get_suggested_menu(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: Session = Depends(get_db)
):
    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid")

    results = (
        db.query(
            MenuSuggestion.menu_name,
            func.count(MenuSuggestion.menu_name).label("usulan_count"),
            func.max(MenuSuggestion.timestamp).label("last_suggested")
        )
        .filter(MenuSuggestion.timestamp >= start_dt, MenuSuggestion.timestamp <= end_dt)
        .group_by(MenuSuggestion.menu_name)
        .order_by(func.count(MenuSuggestion.menu_name).desc())
        .all()
    )

    return [
        {
            "menu_name": r.menu_name,
            "usulan_count": r.usulan_count,
            "last_suggested": r.last_suggested.isoformat()
        }
        for r in results
    ]

@app.get("/report", tags=["Report"])
def get_report(
    start_date: str = Query(...),
    end_date: str = Query(...),
    menu_name: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid")

    query = (
        db.query(OrderItem)
        .join(KitchenOrder, OrderItem.order_id == KitchenOrder.order_id)
        .filter(KitchenOrder.status == "done", OrderItem.timestamp >= start_dt, OrderItem.timestamp <= end_dt)
    )
    if menu_name:
        query = query.filter(OrderItem.menu_name.ilike(f"%{menu_name}%"))

    items = query.all()
    total_income = sum((i.quantity or 0) * (i.unit_price or 0) for i in items)
    grouped = {}
    for i in items:
        if i.menu_name not in grouped:
            grouped[i.menu_name] = {"menu_name": i.menu_name, "quantity": 0, "unit_price": i.unit_price, "total": 0}
        grouped[i.menu_name]["quantity"] += i.quantity or 0
        grouped[i.menu_name]["total"] += (i.quantity or 0) * (i.unit_price or 0)

    return {
        "start_date": start_date,
        "end_date": end_date,
        "total_order": len(items),
        "total_income": total_income,
        "details": sorted(grouped.values(), key=lambda x: x["quantity"], reverse=True)
    }

@app.get("/report/top_customers", tags=["Report"])
def get_top_customers(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: Session = Depends(get_db)
):
    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid")

    results = (
        db.query(
            OrderItem.customer_name,
            func.count(OrderItem.id).label("total_orders"),
            func.sum(OrderItem.quantity * func.coalesce(OrderItem.unit_price, 0)).label("total_spent")
        )
        .filter(OrderItem.timestamp >= start_dt, OrderItem.timestamp <= end_dt)
        .filter(OrderItem.customer_name.isnot(None))
        .group_by(OrderItem.customer_name)
        .order_by(func.sum(OrderItem.quantity * func.coalesce(OrderItem.unit_price, 0)).desc())
        .limit(5)
        .all()
    )

    return [
        {
            "customer_name": r.customer_name,
            "total_orders": r.total_orders,
            "total_spent": int(r.total_spent or 0)
        }
        for r in results
    ]

# Log alamat IP saat service berjalan
hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ report_service sudah running di http://{local_ip}:8004")
