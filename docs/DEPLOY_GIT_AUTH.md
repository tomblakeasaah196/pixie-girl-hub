# Deploy git auth — fixing "could not read Username for 'https://github.com'"

**Symptom:** the production deploy (`.github/workflows/ci.yml` → *Deploy to
Production VPS*) dies at its very first real command:

```
--- Syncing the VPS working tree to origin/main
fatal: could not read Username for 'https://github.com': No such device or address
Process exited with status 128
```

Nothing is built, nothing is reloaded, and the site keeps serving the
previous commit. Running the same `git fetch` by hand on the VPS often
**works**, which is what makes this one confusing.

## Why it happens

The deploy step opens a non-interactive SSH session and runs a script under
`set -e`. The VPS checkout's `origin` is an **HTTPS** URL, and the box has no
GitHub credential of its own for it, so git does the only thing it can: it
asks for a username. There is no terminal on that session, so the ask fails
with `No such device or address` — errno ENXIO from opening `/dev/tty` — and
`set -e` takes the whole deploy down with it.

Three things make it look intermittent:

| | |
| --- | --- |
| **It works when you SSH in yourself** | An interactive login has a tty, so git can prompt — and if you once typed the password with `credential.helper store` configured for *your* user, the credential lives in *your* `~/.git-credentials`, not the deploy user's. |
| **It worked for months, then stopped** | A cached credential expired or was revoked (a PAT hitting its expiry date is the usual one), or the repo flipped from public to private, or the checkout was re-cloned/`git remote set-url`'d to an unauthenticated HTTPS URL. |
| **The error names a username, not a token** | git asks for the username first, so it never gets far enough to complain about the password. The missing thing is the whole credential. |

## The fix (in this repo)

The deploy no longer depends on any credential stored on the box. It carries
one for the length of the run:

1. The job declares `permissions: contents: read` and forwards
   `DEPLOY_GIT_TOKEN` (the workflow's own `github.token`, or the optional
   `VPS_GIT_TOKEN` secret) plus `DEPLOY_GIT_REMOTE` (this repo's canonical
   HTTPS URL) over SSH via the action's `envs:` input.
2. The sync step hands that token to git through a **per-invocation
   credential helper**:

   ```sh
   git -c credential.helper= -c credential.helper="$GIT_CRED_HELPER" \
       fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
   ```

   The first `-c` clears whatever helper the box has configured (a stale
   `store` entry is worse than none), the second supplies ours. The token
   reaches git through the helper's environment, so it is **never written into
   `.git/config`** or any other file on the box, and it stops working when the
   run ends. (It does live in the deploy session's environment while the deploy
   runs — read-only, repo-scoped and short-lived, which is the point of using
   the run's own token rather than parking a long-lived PAT on the box.)
3. `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND="ssh -o BatchMode=yes"` make
   any *future* credential problem fail immediately with a real message
   instead of the ENXIO riddle above.
4. The fetch retries 4 times (2s/4s/8s backoff) for network blips, and falls
   back from `origin` to `$DEPLOY_GIT_REMOTE`, so a stale or unauthenticated
   remote on the box can't block a deploy either.
5. If it still can't fetch, the step prints the remote it tried and points
   here, then exits **before** `git reset --hard` — a deploy that cannot sync
   fails loudly rather than rebuilding and "successfully" redeploying the old
   commit.

The refspec updates `refs/remotes/origin/main` on both paths, so the
`git reset --hard origin/main` that follows is identical either way. The
working-tree-is-disposable rule is unchanged: the VPS is a deploy target, so
local commits and edits there are always discarded.

## Verifying it

A healthy sync logs:

```
--- Syncing the VPS working tree to origin/main
VPS tree now at 1a2b3c4 ✓
```

The `VPS tree now at …` short SHA must match the commit that triggered the
run. The deploy's later *"Verifying the served ERP build matches this
commit"* step checks the same thing from the outside, by reading the
`x-build` meta tag off the served HTML.

## If you need to fix the box by hand

Nothing below is required by the workflow — it's for a manual
`git fetch` on the VPS.

```sh
cd /var/www/pixie-girl-hub
git remote -v                    # what is origin actually pointing at?
```

Two supported shapes:

- **HTTPS + a token.** Keep `origin` as
  `https://github.com/tomblakeasaah196/pixie-girl-hub.git` and authenticate
  per command, so no token is stored in the checkout:

  ```sh
  GIT_TERMINAL_PROMPT=0 \
  DEPLOY_GIT_TOKEN='<fine-grained PAT with Contents: Read>' \
  git -c credential.helper= \
      -c credential.helper='!f() { printf "username=x-access-token\npassword=%s\n" "$DEPLOY_GIT_TOKEN"; }; f' \
      fetch --no-tags origin main
  ```

- **SSH + a deploy key.** Add a read-only deploy key to the repo on GitHub,
  put the private half at `~/.ssh/id_ed25519` for the deploy user, then
  `git remote set-url origin git@github.com:tomblakeasaah196/pixie-girl-hub.git`.
  The workflow's HTTPS fallback still covers the case where that key later
  disappears.

**Do not** embed a token in the remote URL
(`https://<token>@github.com/…`). It lands in `.git/config` in plaintext,
survives every deploy, leaks into any log that echoes a remote, and outlives
whoever set it up.

## Related

- `docs/PDF_RENDERING_SETUP.md` and `docs/UPLOAD_SIZE_LIMITS.md` — the other
  two "works locally, fails live" gotchas on this deploy path.
- `docs/STOREFRONT_DEPLOYMENT.md` — what the deploy builds and reloads after
  this sync succeeds.
