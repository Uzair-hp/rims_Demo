"""
Phase 1 API contract tests.

These lock the two things the frontend depends on: the `/api/v1` prefix and the
`{"data": ...}` / `{"error": {...}}` envelope (PLAN §9.1).
"""


def test_health_returns_ok_envelope(client):
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.is_json

    payload = response.get_json()
    assert payload["data"]["status"] == "ok"
    assert payload["data"]["service"] == "ruchita-interiors-api"
    assert payload["data"]["phase"] == 5
    assert "version" in payload["data"]
    assert "error" not in payload


def test_health_needs_no_session(client):
    """`/health` is public, so it must not depend on a cookie being present."""
    response = client.get("/api/v1/health", headers={"Cookie": ""})

    assert response.status_code == 200


def test_health_sets_json_content_type(client):
    response = client.get("/api/v1/health")

    assert response.headers["Content-Type"].startswith("application/json")


def test_unknown_route_returns_structured_error(client):
    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404

    error = response.get_json()["error"]
    assert error["code"] == "NOT_FOUND"
    assert error["message"]
    assert error["details"] == []


def test_root_points_at_the_api(client):
    response = client.get("/")

    assert response.status_code == 200
    assert response.get_json()["data"]["api"] == "/api/v1/health"


def test_quotation_endpoints_exist_and_are_guarded(client):
    """Phase 5 mounts the quotation endpoints; unauthenticated access is 401, not 404."""
    assert client.get("/api/v1/quotations").status_code == 401
    assert client.post("/api/v1/quotations", json={}).status_code in (401, 403)


def _app_with_origins(origins: str):
    from app import create_app

    return create_app({"TESTING": True, "CORS_ORIGINS": origins})


def test_cors_allows_configured_origin():
    """CORS reads app.config, so a per-app CORS_ORIGINS override is honoured."""
    app = _app_with_origins("https://app.example.test")
    response = app.test_client().get("/api/v1/health", headers={"Origin": "https://app.example.test"})

    assert response.headers.get("Access-Control-Allow-Origin") == "https://app.example.test"
    assert response.headers.get("Access-Control-Allow-Credentials") == "true"


def test_cors_rejects_unknown_origin():
    app = _app_with_origins("https://app.example.test")
    response = app.test_client().get("/api/v1/health", headers={"Origin": "https://evil.example.test"})

    assert "Access-Control-Allow-Origin" not in response.headers


def test_cors_accepts_multiple_configured_origins():
    """§16 allows a comma-separated allow-list, e.g. production plus a staging host."""
    app = _app_with_origins("https://app.example.test,https://staging.example.test")
    test_client = app.test_client()

    for origin in ("https://app.example.test", "https://staging.example.test"):
        response = test_client.get("/api/v1/health", headers={"Origin": origin})
        assert response.headers.get("Access-Control-Allow-Origin") == origin


def test_root_reports_overridden_cors_origins():
    app = _app_with_origins("https://app.example.test")

    assert app.test_client().get("/").get_json()["data"]["frontend"] == "https://app.example.test"
