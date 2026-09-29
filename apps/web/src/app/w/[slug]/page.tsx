// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

export default async function WorkspaceIndex({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  redirect(`/w/${slug}/library`);
}
