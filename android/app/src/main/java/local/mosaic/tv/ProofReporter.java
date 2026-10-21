package local.mosaic.tv;
import android.content.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

final class ProofReporter implements AutoCloseable {
  private final SharedPreferences prefs;
  private final String scope,base,key;
  private final ApiClient api;
  private final ExecutorService network=Executors.newSingleThreadExecutor();
  private final List<JSONObject> queue=new ArrayList<>();
  private boolean uploading,closed;
  private long lastUpload;
  ProofReporter(Context context,ApiClient api,String base,String key,String screen){
    this.api=api;this.base=base;this.key=key;prefs=context.getSharedPreferences("playback-proof",Context.MODE_PRIVATE);
    String name;try{byte[] digest=MessageDigest.getInstance("SHA-256").digest((base+"/"+screen+"/"+key).getBytes(StandardCharsets.UTF_8));StringBuilder b=new StringBuilder();for(byte v:digest)b.append(String.format(Locale.ROOT,"%02x",v));name=b.toString();}catch(Exception e){throw new IllegalStateException(e);}scope=name;
    try{JSONArray a=new JSONArray(prefs.getString(scope,"[]"));for(int n=0;n<a.length();n++)queue.add(a.getJSONObject(n));}catch(Exception ignored){}save();
  }
  private synchronized void save(){long cutoff=System.currentTimeMillis()-7*86400000L;queue.removeIf(e->e.optLong("endAt")<cutoff);while(queue.size()>500)queue.remove(0);prefs.edit().putString(scope,new JSONArray(queue).toString()).apply();}
  synchronized void add(JSONObject event){if(event!=null){queue.add(event);save();}}
  synchronized void flush(){
    if(closed||uploading||queue.isEmpty()||System.currentTimeMillis()-lastUpload<10000)return;
    lastUpload=System.currentTimeMillis();uploading=true;JSONArray batch=new JSONArray(queue.subList(0,Math.min(50,queue.size())));
    network.execute(()->{try{JSONObject result=api.json(base,"/api/device/play-events",key,Protocol.put(new JSONObject(),"events",batch));Set<String> ack=new HashSet<>();JSONArray a=result.optJSONArray("accepted"),r=result.optJSONArray("rejected");if(a!=null)for(int n=0;n<a.length();n++)ack.add(a.optString(n));if(r!=null)for(int n=0;n<r.length();n++)ack.add(r.getJSONObject(n).optString("eventId"));synchronized(this){queue.removeIf(e->ack.contains(e.optString("eventId")));save();}}catch(Exception ignored){}finally{synchronized(this){uploading=false;}}});
  }
  public synchronized void close(){closed=true;network.shutdownNow();save();}
}
