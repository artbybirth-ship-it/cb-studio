"use client";
import { useParams } from "next/navigation";
import EditorShell from "@/components/EditorShell";
export default function EditorPage() {
  const params = useParams<{ id: string }>();
  return <EditorShell projectId={params.id} />;
}
