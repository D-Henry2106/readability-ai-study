
# Workspace Safety Rules - STRICT

## 1. Workspace Boundary
- Only work within the currently opened project directory.
- Never access, modify, create, move, rename or delete files outside the active workspace.
- Never access sibling projects or unrelated repositories.
- Never traverse parent directories to perform unrelated operations.
- Treat every other project on this computer as protected and off-limits.

## 2. Strict File Protection
- NEVER delete an entire project directory.
- NEVER delete unrelated files or folders.
- NEVER perform bulk deletion or cleanup without explicit permission.
- NEVER rename or move project directories.
- NEVER remove files simply because they appear unused.
- Preserve all existing source code, configurations and project data.

## 3. Destructive Operations
NEVER execute these operations without explicit user approval:
- Recursive directory deletion.
- Bulk file deletion.
- File or directory overwriting.
- Git reset --hard.
- Git clean -fd or git clean -fdx.
- Removing dependencies or lockfiles.
- Database deletion or destructive migrations.
- System configuration changes.

Before any destructive operation:
1. Explain what will be changed.
2. List the exact file paths affected.
3. Explain why the operation is necessary.
4. Wait for explicit user approval.

## 4. Project Isolation
- Treat the currently opened workspace as the only authorized project.
- Do not modify other projects even if they are located on the same drive.
- Do not assume permission to access other repositories.
- If a task requires accessing files outside the workspace, stop and ask first.

## 5. Code Modification
- Preserve existing architecture and project structure.
- Make minimal changes relevant to the requested task.
- Do not modify unrelated files.
- Never delete existing functionality without explicit approval.

## 6. Default Behavior
- Read and analyze before modifying.
- Prefer non-destructive operations.
- Ask before deleting, moving, renaming or overwriting files.
- Never sacrifice existing project data for convenience.
- When uncertain, stop and ask the user.
