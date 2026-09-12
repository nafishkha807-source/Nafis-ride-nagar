import math
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Nafis Ride Alwar")

@app.get("/")
def home():
    return {"status": "Live", "location": "Alwar", "range": "30 KM"}
    
