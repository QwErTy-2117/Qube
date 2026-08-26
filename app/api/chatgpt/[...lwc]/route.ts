import { chatGptAuth } from "@/lib/chatgpt/handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return chatGptAuth.handler(request);
}

export async function POST(request: Request) {
  return chatGptAuth.handler(request);
}

export async function PUT(request: Request) {
  return chatGptAuth.handler(request);
}

export async function DELETE(request: Request) {
  return chatGptAuth.handler(request);
}

export async function PATCH(request: Request) {
  return chatGptAuth.handler(request);
}
