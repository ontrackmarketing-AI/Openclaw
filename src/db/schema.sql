-- OpenClaw Personal OS - Database Schema
-- PostgreSQL 15+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client TEXT,
  status TEXT DEFAULT 'active',
  priority INTEGER DEFAULT 3,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tasks
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  source TEXT,
  source_ref TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'open',
  priority INTEGER DEFAULT 3,
  due_date DATE,
  agent_handled BOOLEAN DEFAULT false,
  escalated_to_bryson BOOLEAN DEFAULT false,
  escalation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Notes
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  source TEXT,
  raw_text TEXT,
  structured JSONB,
  image_path TEXT,
  qdrant_ids TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Contacts
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  imessage_handle TEXT,
  telegram_username TEXT,
  type TEXT,
  project_ids UUID[],
  is_vip BOOLEAN DEFAULT false,
  last_contact TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Inbox Events
CREATE TABLE inbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  external_id TEXT,
  sender TEXT,
  contact_id UUID REFERENCES contacts(id),
  project_id UUID REFERENCES projects(id),
  subject TEXT,
  body_summary TEXT,
  intent TEXT,
  agent_action TEXT,
  escalated BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(channel, external_id)
);

-- Escalations
CREATE TABLE escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT,
  project_id UUID REFERENCES projects(id),
  task_id UUID REFERENCES tasks(id),
  inbox_event_id UUID REFERENCES inbox_events(id),
  summary TEXT NOT NULL,
  context TEXT,
  options JSONB,
  status TEXT DEFAULT 'pending',
  telegram_message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  actioned_at TIMESTAMPTZ
);

-- Agent Logs
CREATE TABLE agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT NOT NULL,
  event TEXT NOT NULL,
  project_id UUID REFERENCES projects(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_escalated ON tasks(escalated_to_bryson) WHERE escalated_to_bryson = true;
CREATE INDEX idx_notes_project_id ON notes(project_id);
CREATE INDEX idx_notes_created_at ON notes(created_at);
CREATE INDEX idx_inbox_events_channel ON inbox_events(channel);
CREATE INDEX idx_inbox_events_intent ON inbox_events(intent);
CREATE INDEX idx_inbox_events_processed_at ON inbox_events(processed_at);
CREATE INDEX idx_inbox_events_contact_id ON inbox_events(contact_id);
CREATE INDEX idx_escalations_status ON escalations(status);
CREATE INDEX idx_escalations_created_at ON escalations(created_at);
CREATE INDEX idx_agent_logs_agent ON agent_logs(agent);
CREATE INDEX idx_agent_logs_created ON agent_logs(created_at);
CREATE INDEX idx_contacts_is_vip ON contacts(is_vip) WHERE is_vip = true;
CREATE INDEX idx_contacts_email ON contacts(email) WHERE email IS NOT NULL;
CREATE INDEX idx_contacts_phone ON contacts(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_priority ON projects(priority);
