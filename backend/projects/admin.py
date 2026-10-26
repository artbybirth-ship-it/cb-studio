from django.contrib import admin
from .models import Asset, Project, RenderJob, Scene
admin.site.register(Project)
admin.site.register(Scene)
admin.site.register(Asset)
admin.site.register(RenderJob)
