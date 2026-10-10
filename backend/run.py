"""Start the backend:  python run.py"""

import uvicorn

from app.config import settings
from app.migrate import upgrade

if __name__ == "__main__":
    upgrade()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
    )
