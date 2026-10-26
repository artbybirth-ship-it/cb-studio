import uuid
from django.db import models

def default_editor_data():
    return {
        "background": "#ffffff", "backgroundImage": None,
        "objects": [],
    }

class Project(models.Model):
    STATUS_CHOICES = [("draft", "Draft"), ("rendering", "Rendering"), ("complete", "Complete")]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200)
    width = models.PositiveIntegerField(default=1280)
    height = models.PositiveIntegerField(default=720)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    thumbnail_url = models.URLField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta: ordering = ["-updated_at"]
    def __str__(self): return self.title

class Scene(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, related_name="scenes", on_delete=models.CASCADE)
    name = models.CharField(max_length=200, default="Scene")
    order = models.PositiveIntegerField(default=0)
    duration_seconds = models.FloatField(default=5.0)
    editor_data = models.JSONField(default=default_editor_data)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        ordering = ["order", "created_at"]
        unique_together = [("project", "order")]
    def __str__(self): return f"{self.project.title} / {self.name}"

class Asset(models.Model):
    KIND_CHOICES = [("character", "Character"), ("background", "Background"), ("prop", "Prop"), ("audio", "Audio"), ("fx", "FX")]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, related_name="assets", null=True, blank=True, on_delete=models.CASCADE)
    kind = models.CharField(max_length=30, choices=KIND_CHOICES)
    name = models.CharField(max_length=200)
    url = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    def __str__(self): return self.name

class RenderJob(models.Model):
    STATUS_CHOICES = [("queued", "Queued"), ("running", "Running"), ("complete", "Complete"), ("failed", "Failed")]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, related_name="render_jobs", on_delete=models.CASCADE)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="queued")
    progress = models.PositiveSmallIntegerField(default=0)
    output_url = models.CharField(max_length=500, blank=True)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta: ordering = ["-created_at"]
