-- Vetiva IT Remote Desk PostgreSQL Reference Schema
-- Managed at runtime via Drizzle ORM (src/db/schema.ts)

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'Corporate Operations',
  role_slug TEXT NOT NULL DEFAULT 'employee' REFERENCES roles(slug),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  device_code TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  os_platform TEXT NOT NULL DEFAULT 'Web Browser',
  agent_version TEXT NOT NULL DEFAULT 'web-client-1.0',
  native_agent_linked BOOLEAN NOT NULL DEFAULT FALSE,
  last_active_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  session_code TEXT NOT NULL UNIQUE,
  access_token_hash TEXT NOT NULL,
  host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  technician_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  issue_summary TEXT NOT NULL DEFAULT 'General IT Support',
  failed_join_attempts INTEGER NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  connection_quality TEXT NOT NULL DEFAULT 'good',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  ended_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  end_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_permissions (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL DEFAULT 'View Only',
  can_view_screen BOOLEAN NOT NULL DEFAULT TRUE,
  can_control_input BOOLEAN NOT NULL DEFAULT FALSE,
  can_share_clipboard BOOLEAN NOT NULL DEFAULT FALSE,
  can_transfer_files BOOLEAN NOT NULL DEFAULT FALSE,
  can_record_session BOOLEAN NOT NULL DEFAULT FALSE,
  unattended_access BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_stopped_at TIMESTAMP,
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_participants (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_role TEXT NOT NULL,
  connection_state TEXT NOT NULL DEFAULT 'connected',
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  left_at TIMESTAMP,
  UNIQUE(session_id, user_id)
);

CREATE TABLE IF NOT EXISTS session_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS file_transfers (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  uploader_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256_hash TEXT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'clean',
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  ip_address TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
