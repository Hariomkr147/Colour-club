CREATE INDEX IF NOT EXISTS admin_events_actor ON admin_events(actor);
CREATE INDEX IF NOT EXISTS admin_events_target ON admin_events(target);
CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id);
