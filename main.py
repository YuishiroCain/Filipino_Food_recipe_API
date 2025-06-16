from fastapi import FastAPI, HTTPException, Depends, File, UploadFile, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import List, Optional, Dict
from sqlalchemy import Column, Integer, String, Text, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from jose import jwt, JWTError
from dotenv import load_dotenv
import os, shutil, json
from datetime import datetime, timedelta

# Load environment variables
load_dotenv()
VALID_APP_ID = os.getenv("APP_ID", "demo")
VALID_API_KEY = os.getenv("API_KEY", "demo123")

app = FastAPI(title="Unified Filipino Recipes API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

os.makedirs("images", exist_ok=True)
app.mount("/images", StaticFiles(directory="images"), name="images")

Base = declarative_base()
engine = create_engine("sqlite:///recipes.db", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)

class RecipeDB(Base):
    __tablename__ = "recipes"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    description = Column(Text)
    category = Column(String)
    image = Column(String, nullable=True)
    ingredients = Column(Text)
    steps = Column(Text)
    prep_time = Column(Integer)
    calories = Column(Integer)
    tags = Column(Text)  # JSON-encoded Dict[str, List[str]]
    servings = Column(Integer)
    source = Column(String)
    diet_labels = Column(String)

class CategoryDB(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

SECRET_KEY = "supersecret"
ALGORITHM = "HS256"

class RecipeIn(BaseModel):
    id: int
    title: str
    description: str
    category: str
    image: Optional[str]
    ingredients: List[str]
    steps: List[str]
    prep_time: int
    calories: int
    tags: Dict[str, List[str]]
    servings: int
    source: str
    diet_labels: List[str]

class RecipeOut(RecipeIn):
    class Config:
        orm_mode = True

class PaginatedResponse(BaseModel):
    from_: int
    to: int
    count: int
    hits: List[RecipeOut]

def validate_app_credentials(
    app_id: str = Query(..., alias="app-id"),
    app_key: str = Query(..., alias="app_key")
):
    if app_id != VALID_APP_ID or app_key != VALID_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid app credentials")

@app.get("/", response_class=HTMLResponse)
def home():
    return "<h1>🍽️ Unified Filipino Recipes API is live!</h1>"

@app.get("/recipes", response_model=PaginatedResponse)
def list_recipes(
    app_id: str = Query(..., alias="app-id"),
    app_key: str = Query(..., alias="app_key"),
    query: Optional[str] = None,
    tag: Optional[str] = None,
    max_time: Optional[int] = None,
    from_: int = Query(0, alias="from"),
    size: int = Query(10),
    db: Session = Depends(get_db)
):
    validate_app_credentials(app_id, app_key)
    base = db.query(RecipeDB)

    if query:
        base = base.filter(
            RecipeDB.title.ilike(f"%{query}%") |
            RecipeDB.description.ilike(f"%{query}%") |
            RecipeDB.ingredients.ilike(f"%{query}%")
        )

    if tag:
        try:
            tag_pairs = [t.strip() for t in tag.split(",") if ":" in t]
            all_recipes = base.all()
            filtered = []

            for r in all_recipes:
                tag_dict = json.loads(r.tags) if r.tags else {}
                if all(
                    val in tag_dict.get(cat, [])
                    for cat, val in (pair.split(":", 1) for pair in tag_pairs)
                ):
                    filtered.append(r)

            total = len(filtered)
            recipes = filtered[from_:from_+size]
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid tag format. Use 'Category:Value'")
    else:
        total = base.count()
        recipes = base.offset(from_).limit(size).all()

    hits = []
    for r in recipes:
        hits.append(RecipeOut(
            id=r.id,
            title=r.title,
            description=r.description,
            category=r.category,
            image=r.image,
            ingredients=r.ingredients.split("|") if r.ingredients else [],
            steps=r.steps.split("|") if r.steps else [],
            prep_time=r.prep_time,
            calories=r.calories,
            tags=json.loads(r.tags) if r.tags else {},
            servings=r.servings,
            source=r.source,
            diet_labels=r.diet_labels.split(",") if r.diet_labels else []
        ))

    return {
        "from_": from_,
        "to": from_ + len(hits) - 1,
        "count": total,
        "hits": hits
    }

@app.get("/recipes/{id}", response_model=RecipeOut)
def get_recipe(id: int, db: Session = Depends(get_db)):
    r = db.query(RecipeDB).filter(RecipeDB.id == id).first()
    if not r:
        raise HTTPException(status_code=404)
    return RecipeOut(
        id=r.id,
        title=r.title,
        description=r.description,
        category=r.category,
        image=r.image,
        ingredients=r.ingredients.split("|") if r.ingredients else [],
        steps=r.steps.split("|") if r.steps else [],
        prep_time=r.prep_time,
        calories=r.calories,
        tags=json.loads(r.tags) if r.tags else {},
        servings=r.servings,
        source=r.source,
        diet_labels=r.diet_labels.split(",") if r.diet_labels else []
    )

@app.post("/recipes", response_model=RecipeOut)
def create_recipe(recipe: RecipeIn, db: Session = Depends(get_db)):
    if db.query(RecipeDB).filter(RecipeDB.id == recipe.id).first():
        raise HTTPException(status_code=400, detail="ID already exists.")
    r = RecipeDB(
        **recipe.dict(exclude={"ingredients", "steps", "tags", "diet_labels"}),
        ingredients="|".join(recipe.ingredients),
        steps="|".join(recipe.steps),
        tags=json.dumps(recipe.tags),
        diet_labels=",".join(recipe.diet_labels)
    )
    db.add(r)
    db.commit()
    return recipe

@app.put("/recipes/{id}", response_model=RecipeOut)
def update_recipe(id: int, recipe: RecipeIn, db: Session = Depends(get_db)):
    r = db.query(RecipeDB).filter(RecipeDB.id == id).first()
    if not r:
        raise HTTPException(status_code=404)
    for field, value in recipe.dict().items():
        if field == "ingredients":
            setattr(r, field, "|".join(value))
        elif field == "steps":
            setattr(r, field, "|".join(value))
        elif field == "diet_labels":
            setattr(r, field, ",".join(value))
        elif field == "tags":
            setattr(r, field, json.dumps(value))
        else:
            setattr(r, field, value)
    db.commit()
    return recipe

@app.delete("/recipes/{id}")
def delete_recipe(id: int, db: Session = Depends(get_db)):
    r = db.query(RecipeDB).filter(RecipeDB.id == id).first()
    if not r:
        raise HTTPException(status_code=404)
    db.delete(r)
    db.commit()
    return {"message": "Deleted"}

@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    filename = file.filename
    path = os.path.join("images", filename)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": filename}

@app.get("/categories", response_model=List[str])
def get_categories(app_id: str = Query(..., alias="app-id"), app_key: str = Query(..., alias="app_key"), db: Session = Depends(get_db)):
    validate_app_credentials(app_id, app_key)
    return [c.name for c in db.query(CategoryDB).all()]

@app.post("/categories")
def add_category(name: str = Query(...), db: Session = Depends(get_db)):
    if db.query(CategoryDB).filter(CategoryDB.name.ilike(name)).first():
        return {"message": "Category already exists"}
    db.add(CategoryDB(name=name))
    db.commit()
    return {"message": "Added"}

@app.delete("/categories/{name}")
def delete_category(name: str, db: Session = Depends(get_db)):
    c = db.query(CategoryDB).filter(CategoryDB.name == name).first()
    if not c:
        raise HTTPException(status_code=404)
    db.delete(c)
    db.commit()
    return {"message": "Deleted"}

# Admin token login (simple mock)
@app.post("/token")
def login(username: str = Form(...), password: str = Form(...)):
    if username == "admin" and password == "password":
        return {"access_token": "admin-token"}
    raise HTTPException(status_code=403, detail="Invalid login")
