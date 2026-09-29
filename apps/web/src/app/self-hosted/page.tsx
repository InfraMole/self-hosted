// SPDX-License-Identifier: AGPL-3.0-only
import { permanentRedirect } from "next/navigation";

/** The self-hosting guide moved into the documentation portal (M12). */
export default function SelfHostedPage() {
  permanentRedirect("/docs/installation/requirements");
}
