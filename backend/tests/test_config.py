"""
Configuration tests.

The `test_config` argument to `create_app` has to actually win, because Phase 2
tests and any per-environment deployment will rely on it.
"""

from pathlib import Path


def test_relative_sqlite_uri_is_anchored_to_instance_folder():
    """A bare `sqlite:///name.db` must not land in the process working directory."""
    from app import create_app
    from app.config.settings import BACKEND_ROOT

    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///throwaway.db"})

    uri = app.config["SQLALCHEMY_DATABASE_URI"]
    assert Path(uri.removeprefix("sqlite:///")).is_absolute()
    assert (BACKEND_ROOT / "instance" / "throwaway.db").as_posix() in uri
    assert Path(uri.removeprefix("sqlite:///")).parent.is_dir()


def test_absolute_sqlite_uri_is_preserved(tmp_path):
    from app import create_app

    target = tmp_path / "nested" / "app.db"
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{target.as_posix()}"})

    assert app.config["SQLALCHEMY_DATABASE_URI"] == f"sqlite:///{target.as_posix()}"
    assert target.parent.is_dir()


def test_non_sqlite_uri_is_left_alone():
    """
    Phase 3+ may point at PostgreSQL; the app must not mkdir a URL-shaped path.

    Asserted against the helper rather than `create_app`, which builds the engine
    eagerly and would demand a PostgreSQL driver that Phase 1 does not install.
    """
    from app import _ensure_sqlite_parent

    uri = "postgresql://user:secret@db.internal:5432/ruchita"
    config = {"SQLALCHEMY_DATABASE_URI": uri}
    _ensure_sqlite_parent(config)

    assert config["SQLALCHEMY_DATABASE_URI"] == uri
    assert not Path("db.internal:5432").exists()


def test_testing_flag_from_environment_is_boolean():
    from app.config.settings import _as_bool

    assert _as_bool("RI_UNSET_VARIABLE_FOR_TESTS", False) is False
    assert _as_bool("RI_UNSET_VARIABLE_FOR_TESTS", True) is True

    import os

    os.environ["RI_BOOL_TRUE"] = "  YES "
    os.environ["RI_BOOL_FALSE"] = "0"
    try:
        assert _as_bool("RI_BOOL_TRUE", False) is True
        assert _as_bool("RI_BOOL_FALSE", True) is False
    finally:
        del os.environ["RI_BOOL_TRUE"]
        del os.environ["RI_BOOL_FALSE"]
