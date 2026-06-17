import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.env.WORKSPACE_DATA_DIR || '/data/workspace');

export interface WorkspaceOutput {
  id: string;
  userId: string;
  type: 'document' | 'image' | 'screenshot' | 'capture' | 'app';
  title: string;
  textContent?: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

function userFilePath(userId: string): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(DATA_DIR, `workspace_${sanitized}.json`);
}

export async function saveOutput(output: WorkspaceOutput): Promise<void> {
  const filePath = userFilePath(output.userId);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let outputs: WorkspaceOutput[] = [];
  if (fs.existsSync(filePath)) {
    try {
      outputs = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {}
  }

  const idx = outputs.findIndex(o => o.id === output.id);
  if (idx >= 0) outputs[idx] = output;
  else outputs.push(output);

  fs.writeFileSync(filePath, JSON.stringify(outputs, null, 2), 'utf-8');
}

export async function listOutputs(userId: string): Promise<WorkspaceOutput[]> {
  const filePath = userFilePath(userId);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

export async function deleteOutput(id: string, userId: string): Promise<void> {
  const filePath = userFilePath(userId);
  if (!fs.existsSync(filePath)) return;
  try {
    let outputs: WorkspaceOutput[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    outputs = outputs.filter(o => o.id !== id);
    fs.writeFileSync(filePath, JSON.stringify(outputs, null, 2), 'utf-8');
  } catch {}
}
