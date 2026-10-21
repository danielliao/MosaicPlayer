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

-- AI and integration credentials are installation/tenant scoped, never device keys.
CREATE TABLE IF NOT EXISTS ai_models(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),name text NOT NULL,provider text NOT NULL CHECK(provider IN ('compatible','minimax','gateway')),kind text NOT NULL CHECK(kind IN ('text','image','music','video')),model text NOT NULL,base_url text NOT NULL,secret_cipher text NOT NULL,enabled boolean NOT NULL DEFAULT false,unit_tokens bigint NOT NULL CHECK(unit_tokens>0),monthly_tokens bigint NOT NULL CHECK(monthly_tokens>=0),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ai_quotas(tenant_id uuid NOT NULL REFERENCES tenants(id),model_id uuid NOT NULL REFERENCES ai_models(id),monthly_tokens bigint NOT NULL CHECK(monthly_tokens>=0),PRIMARY KEY(tenant_id,model_id));
CREATE TABLE IF NOT EXISTS ai_usage(model_id uuid NOT NULL REFERENCES ai_models(id),scope text NOT NULL,period date NOT NULL,charged bigint NOT NULL DEFAULT 0 CHECK(charged>=0),reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0),PRIMARY KEY(model_id,scope,period));
CREATE TABLE IF NOT EXISTS api_keys(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL,name text NOT NULL,key_hash text UNIQUE NOT NULL,scopes text[] NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id));
CREATE TABLE IF NOT EXISTS ai_jobs(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL,api_key_id uuid REFERENCES api_keys(id),model_id uuid NOT NULL REFERENCES ai_models(id),kind text NOT NULL,prompt text NOT NULL,lyrics text NOT NULL DEFAULT '',max_output_tokens integer NOT NULL,request_id uuid NOT NULL,request_hash text NOT NULL,status text NOT NULL CHECK(status IN ('queued','running','processing','completed','failed','cancelled')),model_snapshot jsonb NOT NULL,reservation bigint NOT NULL,period date NOT NULL,provider_id text,provider_tokens bigint,charged_tokens bigint NOT NULL DEFAULT 0,result_text text,media_id text,error text,started_at timestamptz,next_poll_at timestamptz,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,request_id),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),FOREIGN KEY(tenant_id,media_id) REFERENCES media(tenant_id,id));
CREATE INDEX IF NOT EXISTS ai_jobs_pending ON ai_jobs(status,next_poll_at);
ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='ai_models') THEN
 CREATE POLICY ai_model_read ON ai_models FOR SELECT USING(tenant_id=context_tenant() OR tenant_id IS NULL);
 CREATE POLICY ai_model_write ON ai_models FOR ALL USING(tenant_id=context_tenant() OR(tenant_id IS NULL AND context_platform() AND context_tenant() IS NULL)) WITH CHECK(tenant_id=context_tenant() OR(tenant_id IS NULL AND context_platform() AND context_tenant() IS NULL)); END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='ai_quotas') THEN CREATE POLICY ai_quota_read ON ai_quotas FOR SELECT USING(tenant_id=context_tenant() OR context_platform()); CREATE POLICY ai_quota_write ON ai_quotas FOR ALL USING(context_platform() AND context_tenant() IS NULL) WITH CHECK(context_platform() AND context_tenant() IS NULL); END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='ai_usage') THEN CREATE POLICY ai_usage_read ON ai_usage FOR SELECT USING(scope=context_tenant()::text OR context_platform()); END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='api_keys') THEN CREATE POLICY api_key_scope ON api_keys USING(tenant_id=context_tenant()) WITH CHECK(tenant_id=context_tenant()); END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename='ai_jobs') THEN CREATE POLICY ai_job_scope ON ai_jobs USING(tenant_id=context_tenant()) WITH CHECK(tenant_id=context_tenant()); END IF;
END$$;
CREATE OR REPLACE FUNCTION auth_api_key(keyhash text) RETURNS TABLE(user_data jsonb,key_data jsonb) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT to_jsonb(u)-'password_hash',to_jsonb(k)-'key_hash' FROM api_keys k JOIN users u ON u.id=k.user_id AND u.tenant_id=k.tenant_id JOIN tenants t ON t.id=k.tenant_id WHERE k.key_hash=keyhash AND k.revoked_at IS NULL AND k.expires_at>now() AND u.enabled AND NOT u.must_change_password AND t.status='active' AND(t.expires_at IS NULL OR t.expires_at>now())
$$;
CREATE OR REPLACE FUNCTION reserve_ai_budget(mid uuid,cost bigint) RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m ai_models; cap bigint; used bigint; p date:=date_trunc('month',now() AT TIME ZONE 'UTC')::date; tid uuid:=context_tenant(); s text;
BEGIN
 IF tid IS NULL OR cost<1 OR cost>1000000 THEN RAISE EXCEPTION 'Invalid AI reservation' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai:'||mid::text,0));
 SELECT * INTO m FROM ai_models WHERE id=mid AND enabled AND(tenant_id=tid OR tenant_id IS NULL) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Model unavailable'; END IF;
 IF m.tenant_id IS NULL THEN SELECT monthly_tokens INTO cap FROM ai_quotas WHERE model_id=mid AND tenant_id=tid; ELSE cap:=m.monthly_tokens; END IF;
 IF cap IS NULL THEN RAISE EXCEPTION 'AI quota not assigned'; END IF;
 FOREACH s IN ARRAY ARRAY[tid::text,'global'] LOOP
  IF s='global' AND m.tenant_id IS NOT NULL THEN CONTINUE; END IF;
  INSERT INTO ai_usage(model_id,scope,period)VALUES(mid,s,p)ON CONFLICT DO NOTHING;
  SELECT charged+reserved INTO used FROM ai_usage WHERE model_id=mid AND scope=s AND period=p FOR UPDATE;
  IF used+cost>(CASE WHEN s='global' THEN m.monthly_tokens ELSE cap END) THEN RAISE EXCEPTION 'AI monthly quota exceeded'; END IF;
  UPDATE ai_usage SET reserved=reserved+cost WHERE model_id=mid AND scope=s AND period=p;
 END LOOP;
 RETURN p;
END$$;
CREATE OR REPLACE FUNCTION settle_ai_budget(jid uuid,charge bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j ai_jobs; shared boolean; BEGIN
 SELECT * INTO j FROM ai_jobs WHERE id=jid AND tenant_id=context_tenant() FOR UPDATE;
 IF NOT FOUND OR j.status NOT IN('queued','running','processing') OR charge<0 OR charge>1000000000 THEN RAISE EXCEPTION 'Invalid AI settlement'; END IF;
 SELECT tenant_id IS NULL INTO shared FROM ai_models WHERE id=j.model_id;
 UPDATE ai_usage SET reserved=reserved-j.reservation,charged=charged+charge WHERE model_id=j.model_id AND period=j.period AND(scope=j.tenant_id::text OR(shared AND scope='global'));
END$$;
REVOKE ALL ON FUNCTION auth_api_key(text),reserve_ai_budget(uuid,bigint),settle_ai_budget(uuid,bigint) FROM PUBLIC;

-- Retail targeting and publication history. All data remains tenant scoped.
CREATE TABLE IF NOT EXISTS retail_store_profiles(tenant_id uuid NOT NULL REFERENCES tenants(id),store_id uuid PRIMARY KEY,profile jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,store_id) REFERENCES stores(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS retail_campaigns(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),name text NOT NULL,config jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','submitted','approved','rejected','published')),approved_revision integer,review_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS retail_publications(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),campaign_id uuid NOT NULL,revision integer NOT NULL,config jsonb NOT NULL,store_snapshots jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(campaign_id,revision),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,campaign_id) REFERENCES retail_campaigns(tenant_id,id));
CREATE TABLE IF NOT EXISTS retail_targets(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),publication_id uuid NOT NULL,store_id uuid NOT NULL,group_id uuid NOT NULL,version_id uuid NOT NULL,deployment_id uuid NOT NULL,attempt integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(publication_id,group_id,attempt),FOREIGN KEY(tenant_id,publication_id) REFERENCES retail_publications(tenant_id,id),FOREIGN KEY(tenant_id,store_id,group_id) REFERENCES groups(tenant_id,store_id,id),FOREIGN KEY(tenant_id,version_id) REFERENCES versions(tenant_id,id),FOREIGN KEY(tenant_id,deployment_id) REFERENCES deployments(tenant_id,id));
CREATE TABLE IF NOT EXISTS retail_pos(tenant_id uuid NOT NULL REFERENCES tenants(id),campaign_id uuid NOT NULL,store_id uuid NOT NULL,date date NOT NULL,sku text NOT NULL,units numeric NOT NULL CHECK(units>=0),revenue numeric NOT NULL CHECK(revenue>=0),PRIMARY KEY(campaign_id,store_id,date,sku),FOREIGN KEY(tenant_id,campaign_id) REFERENCES retail_campaigns(tenant_id,id),FOREIGN KEY(tenant_id,store_id) REFERENCES stores(tenant_id,id));
CREATE TABLE IF NOT EXISTS retail_surveys(tenant_id uuid NOT NULL REFERENCES tenants(id),campaign_id uuid PRIMARY KEY,summary jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,campaign_id) REFERENCES retail_campaigns(tenant_id,id));
ALTER TABLE devices ADD COLUMN IF NOT EXISTS binding_changed_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS playback_events(tenant_id uuid NOT NULL REFERENCES tenants(id),device_id uuid NOT NULL,store_id uuid NOT NULL,group_id uuid NOT NULL,event_id uuid NOT NULL,media_id text NOT NULL,program_id text,start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,duration_ms integer NOT NULL CHECK(duration_ms>0),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,device_id,event_id),CHECK(end_at>start_at),FOREIGN KEY(tenant_id,store_id,group_id) REFERENCES groups(tenant_id,store_id,id));
CREATE INDEX IF NOT EXISTS playback_events_program ON playback_events(tenant_id,program_id,media_id,start_at);
CREATE TABLE IF NOT EXISTS intake_jobs(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL,source_id text NOT NULL,request_id uuid NOT NULL,quality text NOT NULL CHECK(quality IN('tv','full')),status text NOT NULL CHECK(status IN('queued','running','completed','failed')),result_id text,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,request_id),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),FOREIGN KEY(tenant_id,source_id) REFERENCES media(tenant_id,id),FOREIGN KEY(tenant_id,result_id) REFERENCES media(tenant_id,id));
DO $$DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['retail_store_profiles','retail_campaigns','retail_publications','retail_targets','retail_pos','retail_surveys','playback_events','intake_jobs'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename=t AND policyname='tenant_isolation') THEN EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=context_tenant()) WITH CHECK(tenant_id=context_tenant())',t); END IF;
 END LOOP;
END$$;

ALTER TABLE playback_events ALTER COLUMN program_id DROP NOT NULL;

-- Merchant ownership: migrate existing content to shared HQ, default new rows private.
DO $$DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['media','templates'] LOOP
 IF NOT EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='owner_store_id') THEN
 EXECUTE format('ALTER TABLE %I ADD COLUMN owner_store_id uuid',t);
 EXECUTE format('ALTER TABLE %I ADD COLUMN shared boolean NOT NULL DEFAULT true',t);
 END IF;
 EXECUTE format('ALTER TABLE %I ALTER COLUMN shared SET DEFAULT false',t);
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conname=t||'_owner_store_scope') THEN EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(tenant_id,owner_store_id) REFERENCES stores(tenant_id,id)',t,t||'_owner_store_scope');END IF;
 END LOOP;
END$$;
CREATE TABLE IF NOT EXISTS content_designs(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),owner_store_id uuid,shared boolean NOT NULL DEFAULT false,name text NOT NULL,body jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,owner_store_id) REFERENCES stores(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id));
CREATE TABLE IF NOT EXISTS design_jobs(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),design_id uuid NOT NULL,revision integer NOT NULL,snapshot jsonb NOT NULL,request_id uuid NOT NULL,status text NOT NULL CHECK(status IN('queued','running','completed','failed')),user_id uuid NOT NULL,result_id text,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,request_id),FOREIGN KEY(tenant_id,design_id) REFERENCES content_designs(tenant_id,id),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),FOREIGN KEY(tenant_id,result_id) REFERENCES media(tenant_id,id));
DO $$DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['content_designs','design_jobs'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 IF NOT EXISTS(SELECT FROM pg_policies WHERE tablename=t AND policyname='tenant_isolation') THEN EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=context_tenant()) WITH CHECK(tenant_id=context_tenant())',t);END IF;
 END LOOP;
END$$;
