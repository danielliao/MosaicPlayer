package local.mosaic.tv;
import okhttp3.*;
import org.json.*;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
public final class ControllerApi {
 private final HttpUrl base; private final String key;
 private final OkHttpClient client=new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).callTimeout(20,TimeUnit.SECONDS).build();
 public ControllerApi(String server,String key){
  base=HttpUrl.get(server);
  if(!base.username().isEmpty()||!base.password().isEmpty()||!base.encodedPath().equals("/")||base.query()!=null||base.fragment()!=null)throw new IllegalArgumentException("Invalid server");
  if(key.trim().isEmpty()||key.contains("\n")||key.contains("\r"))throw new IllegalArgumentException("Invalid key"); this.key=key;
 }
 public JSONArray list(String resource)throws Exception {
  if(!resource.equals("groups")&&!resource.equals("media"))throw new IllegalArgumentException("Invalid resource");
  return new JSONArray(request(base.newBuilder().addPathSegments("api/v1").addPathSegment(resource).build(),null));
 }
 public void control(String group,ControllerCommand command)throws Exception {
  if(!ControllerCommand.canConfirm(group,command))throw new IllegalArgumentException("Invalid command");
  JSONObject body=new JSONObject().put("action",command.action);if(command.mediaId!=null)body.put("mediaId",command.mediaId);
  request(base.newBuilder().addPathSegments("api/v1/groups").addPathSegment(group).addPathSegment("control").build(),body.toString());
 }
 private String request(HttpUrl url,String json)throws IOException {
  Request.Builder request=new Request.Builder().url(url).header("Authorization","Bearer "+key);
  if(json!=null)request.post(RequestBody.create(json,MediaType.get("application/json")));
  try(Response response=client.newCall(request.build()).execute()){
   if(!response.isSuccessful())throw new IOException("HTTP "+response.code());
   return response.body()==null?"":response.body().string();
  }
 }
}
