# Agent Guidelines

## Building and Testing Changes

**Always run `docker compose build` after making code changes** to ensure everything compiles and works correctly before considering a task complete.

```bash
docker compose build
```

This command will:

- Build the Flask backend and verify Python code compiles
- Build the Next.js frontend and run TypeScript type-checking
- Catch any build errors early before deployment

## Verifying the Build

After a successful build, you can verify the services are working by running:

```bash
docker compose up -d
```

Then check the health endpoint:

```bash
curl http://localhost:3000/api/health
```

## Common Build Issues

- **Next.js TypeScript errors**: Fix type mismatches in `.tsx` files
- **Flask errors**: Check Python syntax and imports in `app.py`
- **Database schema changes**: Run `docker compose up` to apply new migrations
