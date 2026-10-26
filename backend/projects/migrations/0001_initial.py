import uuid
from django.db import migrations, models
import django.db.models.deletion
import projects.models

class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(name="Project", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("title", models.CharField(max_length=200)), ("width", models.PositiveIntegerField(default=1280)),
            ("height", models.PositiveIntegerField(default=720)),
            ("status", models.CharField(choices=[("draft", "Draft"), ("rendering", "Rendering"), ("complete", "Complete")], default="draft", max_length=20)),
            ("thumbnail_url", models.URLField(blank=True)), ("created_at", models.DateTimeField(auto_now_add=True)),
            ("updated_at", models.DateTimeField(auto_now=True)),
        ], options={"ordering": ["-updated_at"]}),
        migrations.CreateModel(name="Scene", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("name", models.CharField(default="Scene", max_length=200)), ("order", models.PositiveIntegerField(default=0)),
            ("duration_seconds", models.FloatField(default=5.0)), ("editor_data", models.JSONField(default=projects.models.default_editor_data)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="scenes", to="projects.project")),
        ], options={"ordering": ["order", "created_at"], "unique_together": {("project", "order")}}),
        migrations.CreateModel(name="Asset", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("kind", models.CharField(choices=[("character", "Character"), ("background", "Background"), ("prop", "Prop"), ("audio", "Audio")], max_length=30)),
            ("name", models.CharField(max_length=200)), ("url", models.TextField()), ("metadata", models.JSONField(blank=True, default=dict)),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("project", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="assets", to="projects.project")),
        ]),
        migrations.CreateModel(name="RenderJob", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("status", models.CharField(choices=[("queued", "Queued"), ("running", "Running"), ("complete", "Complete"), ("failed", "Failed")], default="queued", max_length=20)),
            ("progress", models.PositiveSmallIntegerField(default=0)), ("output_url", models.CharField(blank=True, max_length=500)),
            ("error", models.TextField(blank=True)), ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="render_jobs", to="projects.project")),
        ], options={"ordering": ["-created_at"]}),
    ]
