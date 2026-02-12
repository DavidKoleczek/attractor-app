import argparse
import os


def main() -> None:
    parser = argparse.ArgumentParser(description="Attractor Issues Server")
    parser.add_argument(
        "--production",
        action="store_true",
        help="Enable production mode: download frontend and serve it. Binds to 0.0.0.0 by default.",
    )
    parser.add_argument(
        "--update-frontend",
        action="store_true",
        help="Force re-download of the frontend build. Implies --production.",
    )
    parser.add_argument(
        "--host",
        type=str,
        default=None,
        help="Override listen address.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Override listen port.",
    )
    args = parser.parse_args()

    if args.update_frontend:
        args.production = True

    # Set environment variables so Settings picks them up
    if args.production:
        os.environ["ATTRACTOR_PRODUCTION"] = "true"
    if args.host:
        os.environ["ATTRACTOR_HOST"] = args.host
    if args.port:
        os.environ["ATTRACTOR_PORT"] = str(args.port)

    # In production mode, fetch the frontend build
    if args.production:
        from .config import Settings
        from .frontend import fetch_frontend

        settings = Settings()
        frontend_dir = fetch_frontend(settings, force=args.update_frontend)
        os.environ["ATTRACTOR_FRONTEND_DIR"] = str(frontend_dir)

    host = args.host or ("0.0.0.0" if args.production else "127.0.0.1")
    port = args.port or 8000

    import uvicorn

    uvicorn.run("issues_server.main:app", host=host, port=port)
