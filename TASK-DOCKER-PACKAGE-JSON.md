# Docker ES Module Error: package.json Permissions Issue

## Problem

When running the backend container, Node.js fails with:

```
SyntaxError: Cannot use import statement outside a module
```

Despite `package.json` having `"type": "module"` configured correctly.

## Root Cause

In a multi-stage Docker build, files copied with `COPY` inherit their original permissions from the build context. The `package.json` file had permissions `-rw-r-----` (readable only by root/root group).

When the container runs as a non-root user (`nodejs`), it cannot read `package.json`. Node.js therefore cannot detect the `"type": "module"` setting and defaults to CommonJS mode, causing the ES module import syntax to fail.

## Solution

In the Dockerfile, ensure the non-root user is created **before** copying files, then set proper ownership:

```dockerfile
# Create non-root user FIRST
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Set ownership for the nodejs user
RUN chown -R nodejs:nodejs /app

USER nodejs
```

The key changes:
1. Create the `nodejs` user before copying files
2. Add `chown -R nodejs:nodejs /app` to grant read access to all app files
3. Switch to `USER nodejs` after setting permissions

## Verification

To verify the fix, check file permissions inside the container:

```bash
docker run --rm --user root <image-name> ls -la /app/
```

The `package.json` should be readable by the `nodejs` user.
