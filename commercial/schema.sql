CREATE TABLE IF NOT EXISTS tenants(id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')), expires_at timestamptz, limits jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),username text UNIQUE NOT NULL,name text NOT NULL,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('platform_admin','tenant_admin','operator','store_operator','viewer')),store_ids uuid[] NOT NULL DEFAULT '{}',enabled boolean NOT NULL DEFAULT true,must_change_password boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),CHECK((role='platform_admin')=(tenant_id IS NULL)));
CREATE TABLE IF NOT EXISTS sessions(id text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf text NOT NULL,support_tenant_id uuid REFERENCES tenants(id),support_reason text,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS stores(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),name text NOT NULL,timezone text NOT NULL,template_version_id uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS groups(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),store_id uuid NOT NULL,name text NOT NULL,layout jsonb NOT NULL,audio_screen_id text,playback jsonb NOT NULL DEFAULT '{"mediaId":null,"epoch":0,"paused":true,"position":0,"revision":0}',program jsonb,pending_id uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,store_id,id),FOREIGN KEY(tenant_id,store_id) REFERENCES stores(tenant_id,id));
CREATE TABLE IF NOT EXISTS screens(id text PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),group_id uuid NOT NULL,UNIQUE(tenant_id,id),UNIQUE(tenant_id,group_id,id),FOREIGN KEY(tenant_id,group_id) REFERENCES groups(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS devices(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),store_id uuid NOT NULL,group_id uuid NOT NULL,screen_id text NOT NULL UNIQUE,name text NOT NULL,key_hash text UNIQUE NOT NULL,client text,last_seen timestamptz,report jsonb NOT NULL DEFAULT '{}',capabilities text[] NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,store_id,group_id) REFERENCES groups(tenant_id,store_id,id),FOREIGN KEY(tenant_id,group_id,screen_id) REFERENCES screens(tenant_id,group_id,id));
CREATE TABLE IF NOT EXISTS pairings(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),store_id uuid NOT NULL,group_id uuid,code_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,consumed_at timestamptz,FOREIGN KEY(tenant_id,store_id) REFERENCES stores(tenant_id,id),FOREIGN KEY(tenant_id,store_id,group_id) REFERENCES groups(tenant_id,store_id,id));
CREATE TABLE IF NOT EXISTS media(id text PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),metadata jsonb NOT NULL,filename text NOT NULL,size bigint NOT NULL CHECK(size>=0),archived boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS upload_reservations(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),size bigint NOT NULL CHECK(size>0),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS templates(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),name text NOT NULL,description text NOT NULL DEFAULT '',body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS versions(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),template_id uuid NOT NULL,name text NOT NULL,body jsonb NOT NULL,sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,template_id) REFERENCES templates(tenant_id,id));
CREATE TABLE IF NOT EXISTS deployments(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),group_id uuid NOT NULL,version_id uuid,manifest jsonb,media_id text,activate_at timestamptz,deadline timestamptz NOT NULL,status text NOT NULL,expected uuid[] NOT NULL DEFAULT '{}',ready uuid[] NOT NULL DEFAULT '{}',errors jsonb NOT NULL DEFAULT '{}',progress jsonb NOT NULL DEFAULT '{}',lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,group_id) REFERENCES groups(tenant_id,id),FOREIGN KEY(tenant_id,version_id) REFERENCES versions(tenant_id,id),FOREIGN KEY(tenant_id,media_id) REFERENCES media(tenant_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_group ON deployments(group_id) WHERE status IN ('preparing','waiting','queued');
CREATE TABLE IF NOT EXISTS commands(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),device_id uuid NOT NULL,type text NOT NULL,body jsonb NOT NULL,status text NOT NULL DEFAULT 'queued',error text,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,device_id) REFERENCES devices(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS screenshots(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),store_id uuid NOT NULL,device_id uuid NOT NULL,request_id uuid NOT NULL UNIQUE,filename text NOT NULL,captured_at timestamptz NOT NULL,metadata jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,device_id) REFERENCES devices(tenant_id,id) ON DELETE CASCADE,FOREIGN KEY(tenant_id,request_id) REFERENCES commands(tenant_id,id),FOREIGN KEY(tenant_id,store_id) REFERENCES stores(tenant_id,id));
CREATE TABLE IF NOT EXISTS releases(id uuid PRIMARY KEY,metadata jsonb NOT NULL,filename text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),actor_id uuid,action text NOT NULL,target text,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS import_runs(id text PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),summary jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION context_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('app.tenant_id',true),'')::uuid$$;
CREATE OR REPLACE FUNCTION context_platform() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('app.platform',true),'')='true'$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['stores','groups','screens','devices','pairings','media','upload_reservations','templates','versions','deployments','commands','screenshots','import_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename=t AND policyname='tenant_isolation') THEN EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=context_tenant()) WITH CHECK(tenant_id=context_tenant())',t); END IF;
  END LOOP;
END $$;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='tenants') THEN CREATE POLICY tenants_scope ON tenants USING(id=context_tenant() OR context_platform()) WITH CHECK(context_platform()); END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='users') THEN CREATE POLICY users_scope ON users USING(tenant_id=context_tenant() OR (context_platform() AND tenant_id IS NULL)) WITH CHECK(tenant_id=context_tenant() OR (context_platform() AND tenant_id IS NULL)); END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='sessions') THEN CREATE POLICY sessions_scope ON sessions USING(user_id IN(SELECT id FROM users)) WITH CHECK(user_id IN(SELECT id FROM users)); END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='releases') THEN CREATE POLICY releases_read ON releases FOR SELECT USING(true); CREATE POLICY releases_write ON releases FOR ALL USING(context_platform()) WITH CHECK(context_platform()); END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='audit') THEN CREATE POLICY audit_read ON audit FOR SELECT USING(tenant_id=context_tenant() OR(context_platform() AND tenant_id IS NULL)); CREATE POLICY audit_insert ON audit FOR INSERT WITH CHECK(tenant_id=context_tenant() OR(context_platform() AND tenant_id IS NULL)); END IF;
END$$;
CREATE OR REPLACE FUNCTION auth_user(uname text) RETURNS SETOF users LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT * FROM users WHERE username=uname AND enabled$$;
CREATE OR REPLACE FUNCTION auth_session(sid text) RETURNS TABLE(user_data jsonb,session_data jsonb) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT to_jsonb(u)-'password_hash',to_jsonb(s) FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=sid AND s.expires_at>now() AND u.enabled$$;
CREATE OR REPLACE FUNCTION auth_device(keyhash text) RETURNS SETOF devices LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT * FROM devices WHERE key_hash=keyhash$$;
CREATE OR REPLACE FUNCTION auth_pairing(codehash text) RETURNS SETOF pairings LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT * FROM pairings WHERE code_hash=codehash AND consumed_at IS NULL AND expires_at>now()$$;
CREATE OR REPLACE FUNCTION worker_tenants() RETURNS TABLE(id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT id FROM tenants$$;
CREATE OR REPLACE FUNCTION immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'published versions are immutable'; END$$;
DROP TRIGGER IF EXISTS protect_versions ON versions;
CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON versions FOR EACH ROW EXECUTE FUNCTION immutable_version();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS store_id uuid;
UPDATE screenshots s SET store_id=d.store_id FROM devices d WHERE d.id=s.device_id AND s.store_id IS NULL;
ALTER TABLE screenshots ALTER COLUMN store_id SET NOT NULL;
DO $$BEGIN IF NOT EXISTS(SELECT FROM pg_constraint WHERE conname='screenshots_store_scope')THEN ALTER TABLE screenshots ADD CONSTRAINT screenshots_store_scope FOREIGN KEY(tenant_id,store_id) REFERENCES stores(tenant_id,id); END IF; END$$;
CREATE OR REPLACE FUNCTION purge_expired_metadata() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$BEGIN
 DELETE FROM audit WHERE tenant_id=context_tenant() AND created_at<now()-interval '180 days';
 DELETE FROM sessions WHERE expires_at<now()-interval '1 day';
END$$;
REVOKE ALL ON FUNCTION purge_expired_metadata() FROM PUBLIC;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS binding_revision integer NOT NULL DEFAULT 0;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS batch_id uuid;
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='groups' AND column_name='inherits_store_template') THEN
  ALTER TABLE groups ADD COLUMN inherits_store_template boolean NOT NULL DEFAULT true;
  ALTER TABLE groups ADD COLUMN template_version_id uuid;
  UPDATE groups SET template_version_id=(program->>'versionId')::uuid,inherits_store_template=false WHERE program->>'versionId' IS NOT NULL;
 END IF;
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conname='stores_template_scope') THEN ALTER TABLE stores ADD CONSTRAINT stores_template_scope FOREIGN KEY(tenant_id,template_version_id) REFERENCES versions(tenant_id,id); END IF;
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conname='groups_template_scope') THEN ALTER TABLE groups ADD CONSTRAINT groups_template_scope FOREIGN KEY(tenant_id,template_version_id) REFERENCES versions(tenant_id,id); END IF;
END$$;
