from rest_framework import serializers
from .models import Asset, Project, RenderJob, Scene

class SceneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Scene
        fields = ["id", "project", "name", "order", "duration_seconds", "editor_data", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

class ProjectSerializer(serializers.ModelSerializer):
    scenes = SceneSerializer(many=True, read_only=True)
    class Meta:
        model = Project
        fields = ["id", "title", "width", "height", "status", "thumbnail_url", "scenes", "created_at", "updated_at"]
        read_only_fields = ["id", "status", "created_at", "updated_at"]

class AssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Asset
        fields = ["id", "project", "kind", "name", "url", "metadata", "created_at"]
        read_only_fields = ["id", "created_at"]

class RenderJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = RenderJob
        fields = ["id", "project", "status", "progress", "output_url", "error", "created_at", "updated_at"]
        read_only_fields = fields
