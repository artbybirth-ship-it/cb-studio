from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Asset, Project


class ProjectApiTests(APITestCase):
    def test_create_project_also_creates_first_scene(self):
        response = self.client.post("/api/projects", {"title": "Demo"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        project = Project.objects.get(id=response.data["id"])
        self.assertEqual(project.scenes.count(), 1)
        self.assertEqual(project.scenes.first().name, "Scene 1")

    def test_add_scene_action(self):
        project = Project.objects.create(title="Demo")
        response = self.client.post(f"/api/projects/{project.id}/add_scene", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(project.scenes.count(), 1)

    def test_upload_background_asset(self):
        project = Project.objects.create(title="Demo")
        image = SimpleUploadedFile("bg.png", b"fake-png", content_type="image/png")
        response = self.client.post(
            "/api/assets/upload",
            {"project": str(project.id), "kind": "background", "file": image},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Asset.objects.count(), 1)
        self.assertEqual(response.data["kind"], "background")
        self.assertTrue(response.data["url"].startswith("/media/assets/background/"))

    def test_reject_wrong_voice_mime_type(self):
        project = Project.objects.create(title="Demo")
        wrong = SimpleUploadedFile("voice.txt", b"hello", content_type="text/plain")
        response = self.client.post(
            "/api/assets/upload",
            {"project": str(project.id), "kind": "audio", "file": wrong},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_session_login_and_logout(self):
        initial = self.client.get("/api/admin/session")
        self.assertEqual(initial.status_code, status.HTTP_200_OK)
        self.assertFalse(initial.json()["authenticated"])

        bad = self.client.post(
            "/api/admin/session",
            {"loginId": "admin", "password": "wrong"},
            format="json",
        )
        self.assertEqual(bad.status_code, status.HTTP_401_UNAUTHORIZED)

        good = self.client.post(
            "/api/admin/session",
            {"loginId": "admin", "password": "CBStudio@2026"},
            format="json",
        )
        self.assertEqual(good.status_code, status.HTTP_200_OK)
        self.assertTrue(good.json()["authenticated"])

        session = self.client.get("/api/admin/session")
        self.assertTrue(session.json()["authenticated"])

        logout = self.client.delete("/api/admin/session")
        self.assertEqual(logout.status_code, status.HTTP_204_NO_CONTENT)
        after = self.client.get("/api/admin/session")
        self.assertFalse(after.json()["authenticated"])

    def test_character_library_mutation_requires_admin(self):
        fake_zip = SimpleUploadedFile("characters.zip", b"not-a-zip", content_type="application/zip")
        response = self.client.post(
            "/api/assets/character-library",
            {"file": fake_zip},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_admin_can_delete_registered_character_library_asset(self):
        login = self.client.post(
            "/api/admin/session",
            {"loginId": "admin", "password": "CBStudio@2026"},
            format="json",
        )
        self.assertEqual(login.status_code, status.HTTP_200_OK)
        asset = Asset.objects.create(
            project=None,
            kind="character",
            name="Demo Library",
            url="/media/character_libraries/00000000-0000-0000-0000-000000000001/",
            metadata={
                "characterLibraryPackage": True,
                "packageId": "00000000-0000-0000-0000-000000000001",
                "characters": [],
            },
        )
        response = self.client.delete(f"/api/assets/character-library?packageId={asset.id}")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Asset.objects.filter(id=asset.id).exists())
