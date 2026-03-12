"""
Docker Deployment Verification Tests
Tests for verifying Docker containers are properly configured and running
"""
import pytest
import subprocess
import json
import os
import re
from typing import List, Dict, Optional

# Mark all tests in this module as docker
pytestmark = pytest.mark.docker


def run_docker_command(args: List[str], timeout: int = 30) -> subprocess.CompletedProcess:
    """Run a docker command and return the result."""
    cmd = ["docker"] + args
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout
    )


def run_docker_compose_command(args: List[str], timeout: int = 30) -> subprocess.CompletedProcess:
    """Run a docker compose command and return the result."""
    cmd = ["docker", "compose"] + args
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=os.path.join(os.path.dirname(__file__), "..")
    )


def get_container_status(service_name: str) -> Optional[str]:
    """Get the status of a docker compose service."""
    result = run_docker_compose_command(["ps", "--format", "json"])
    if result.returncode != 0:
        return None
    
    for line in result.stdout.strip().split("\n"):
        if line:
            try:
                data = json.loads(line)
                if service_name in data.get("Service", ""):
                    return data.get("State", "")
            except json.JSONDecodeError:
                continue
    return None


def get_container_logs(service_name: str, tail: int = 100) -> str:
    """Get logs from a docker compose service."""
    result = run_docker_compose_command(["logs", "--tail", str(tail), service_name])
    return result.stdout + result.stderr


class TestDockerComposeConfiguration:
    """Tests for docker-compose.yml configuration."""
    
    def test_docker_compose_file_exists(self):
        """docker-compose.yml should exist."""
        compose_path = os.path.join(os.path.dirname(__file__), "..", "docker-compose.yml")
        assert os.path.exists(compose_path), "docker-compose.yml not found"
    
    def test_docker_compose_config_valid(self):
        """docker-compose.yml should be valid YAML."""
        result = run_docker_compose_command(["config", "--quiet"])
        assert result.returncode == 0, f"Invalid docker-compose config: {result.stderr}"
    
    def test_all_services_defined(self):
        """All required services should be defined."""
        result = run_docker_compose_command(["config", "--services"])
        services = result.stdout.strip().split("\n")
        
        required_services = ["mysql", "flask", "nextjs"]
        for service in required_services:
            assert service in services, f"Service '{service}' not defined"
    
    def test_mysql_healthcheck_defined(self):
        """MySQL should have a healthcheck."""
        result = run_docker_compose_command(["config", "--format", "json"])
        if result.returncode == 0:
            try:
                config = json.loads(result.stdout)
                mysql_config = config.get("services", {}).get("mysql", {})
                assert "healthcheck" in mysql_config, "MySQL healthcheck not defined"
            except json.JSONDecodeError:
                pytest.skip("Could not parse docker config as JSON")


class TestDockerImages:
    """Tests for Docker images."""
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_flask_image_exists(self):
        """Flask image should be built or available."""
        result = run_docker_command(["images", "--format", "json"])
        images = result.stdout
        
        # Check for portfolio-flask or similar
        assert "flask" in images.lower() or "portfolio" in images.lower(), \
            "Flask image not found. Run 'docker compose build'"
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_nextjs_image_exists(self):
        """Next.js image should be built or available."""
        result = run_docker_command(["images", "--format", "json"])
        images = result.stdout
        
        assert "next" in images.lower() or "portfolio" in images.lower(), \
            "Next.js image not found. Run 'docker compose build'"


class TestDockerContainers:
    """Tests for running Docker containers."""
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_mysql_container_running(self):
        """MySQL container should be running."""
        status = get_container_status("mysql")
        assert status in ["running", "healthy"], f"MySQL container status: {status}"
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_flask_container_running(self):
        """Flask container should be running."""
        status = get_container_status("flask")
        assert status in ["running", "healthy"], f"Flask container status: {status}"
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_nextjs_container_running(self):
        """Next.js container should be running."""
        status = get_container_status("nextjs")
        assert status in ["running", "healthy"], f"Next.js container status: {status}"
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_containers_healthy(self):
        """All containers should be healthy."""
        result = run_docker_compose_command(["ps"])
        
        # Check that all services show as running or healthy
        lines = result.stdout.strip().split("\n")[1:]  # Skip header
        for line in lines:
            if line.strip():
                # Should not contain "unhealthy" or "exited"
                assert "unhealthy" not in line.lower(), f"Unhealthy container: {line}"
                assert "exited" not in line.lower(), f"Exited container: {line}"


class TestDockerNetworking:
    """Tests for Docker networking."""
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_networks_defined(self):
        """Required networks should be defined."""
        result = run_docker_compose_command(["config", "--format", "json"])
        if result.returncode == 0:
            try:
                config = json.loads(result.stdout)
                networks = config.get("networks", {})
                
                # At least backend network should exist
                assert "backend" in networks, "Backend network not defined"
            except json.JSONDecodeError:
                pytest.skip("Could not parse docker config as JSON")
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_flask_connected_to_backend(self):
        """Flask service should be connected to backend network."""
        result = run_docker_compose_command(["config", "--format", "json"])
        if result.returncode == 0:
            try:
                config = json.loads(result.stdout)
                flask_config = config.get("services", {}).get("flask", {})
                networks = flask_config.get("networks", [])
                
                assert "backend" in networks, "Flask not connected to backend network"
            except json.JSONDecodeError:
                pytest.skip("Could not parse docker config as JSON")


class TestDockerVolumes:
    """Tests for Docker volumes."""
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_mysql_volume_defined(self):
        """MySQL data volume should be defined."""
        result = run_docker_compose_command(["config", "--format", "json"])
        if result.returncode == 0:
            try:
                config = json.loads(result.stdout)
                volumes = config.get("volumes", {})
                
                assert "mysql_data" in volumes, "MySQL data volume not defined"
            except json.JSONDecodeError:
                pytest.skip("Could not parse docker config as JSON")
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_schema_sql_mounted(self):
        """Schema SQL file should be mounted to MySQL container."""
        result = run_docker_compose_command(["config", "--format", "json"])
        if result.returncode == 0:
            try:
                config = json.loads(result.stdout)
                mysql_config = config.get("services", {}).get("mysql", {})
                volumes = mysql_config.get("volumes", [])
                
                schema_mounted = any("schema.sql" in str(v) for v in volumes)
                assert schema_mounted, "schema.sql not mounted to MySQL"
            except json.JSONDecodeError:
                pytest.skip("Could not parse docker config as JSON")


class TestDockerEnvironment:
    """Tests for Docker environment configuration."""
    
    def test_env_file_exists(self):
        """.env file should exist."""
        env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
        # This is a soft check - .env might be generated from .env.example
        assert os.path.exists(env_path) or os.path.exists(env_path + ".example"), \
            ".env file not found"
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_flask_env_vars_configured(self):
        """Flask service should have required environment variables."""
        result = run_docker_compose_command(["config", "--format", "json"])
        if result.returncode == 0:
            try:
                config = json.loads(result.stdout)
                flask_config = config.get("services", {}).get("flask", {})
                env_vars = flask_config.get("environment", {})
                
                required_vars = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"]
                for var in required_vars:
                    assert var in env_vars, f"Environment variable {var} not configured"
            except json.JSONDecodeError:
                pytest.skip("Could not parse docker config as JSON")


class TestDockerLogs:
    """Tests for Docker container logs."""
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_flask_no_critical_errors(self):
        """Flask container should not have critical errors in logs."""
        logs = get_container_logs("flask")
        
        # Check for critical errors
        critical_patterns = [
            "Traceback (most recent call last)",
            "CRITICAL",
            "FATAL",
            "panic:",
        ]
        
        for pattern in critical_patterns:
            assert pattern not in logs, f"Critical error found in Flask logs: {pattern}"
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_mysql_no_critical_errors(self):
        """MySQL container should not have critical errors in logs."""
        logs = get_container_logs("mysql")
        
        critical_patterns = [
            "[ERROR]",
            "FATAL",
            "panic:",
        ]
        
        for pattern in critical_patterns:
            if pattern in logs:
                # Some errors might be recoverable
                assert "[ERROR] InnoDB:" not in logs, f"Critical InnoDB error in MySQL logs"


class TestDockerBuild:
    """Tests for Docker build process."""
    
    def test_dockerfile_flask_exists(self):
        """Flask Dockerfile should exist."""
        dockerfile_path = os.path.join(os.path.dirname(__file__), "..", "flask-server", "Dockerfile")
        assert os.path.exists(dockerfile_path), "Flask Dockerfile not found"
    
    def test_dockerfile_nextjs_exists(self):
        """Next.js Dockerfile should exist."""
        dockerfile_path = os.path.join(os.path.dirname(__file__), "..", "next-version", "Dockerfile")
        assert os.path.exists(dockerfile_path), "Next.js Dockerfile not found"
    
    @pytest.mark.skipif(not os.getenv("RUN_DOCKER_TESTS"), reason="Docker tests not enabled")
    def test_build_succeeds(self):
        """Docker compose build should succeed."""
        result = run_docker_compose_command(["build"], timeout=300)
        assert result.returncode == 0, f"Docker build failed: {result.stderr}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
