"use client";

import "@elevenlabs/client";
import { ConversationProvider } from "@elevenlabs/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <ConversationProvider>{children}</ConversationProvider>;
}
