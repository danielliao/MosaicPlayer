package local.mosaic.tv;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
import okhttp3.mockwebserver.*;
public class ControllerTest {
 @Test public void grammarIsExactAndMediaMustBeUnique() {
  Map<String,String> media=new HashMap<>(); media.put("a","Demo");
  assertEquals("pause",ControllerCommand.parse("暂停",media).action);
  assertEquals("resume",ControllerCommand.parse("resume",media).action);
  assertEquals("a",ControllerCommand.parse("play Demo",media).mediaId);
  assertNull(ControllerCommand.parse("please pause",media));
  assertNull(ControllerCommand.parse("播放 unknown",media));
  media.put("b","Demo"); assertNull(ControllerCommand.parse("play Demo",media));
 }
 @Test public void draftNeedsGroupAndNeverExecutesItself() {
  assertFalse(ControllerCommand.canConfirm("",ControllerCommand.parse("pause",Collections.emptyMap())));
  assertFalse(ControllerCommand.canConfirm("group",null));
  assertTrue(ControllerCommand.canConfirm("group",ControllerCommand.parse("pause",Collections.emptyMap())));
 }
 @Test public void apiRejectsScopeFailureRedirectAndUnsafeOrigin() throws Exception {
  try(MockWebServer server=new MockWebServer()) {
   server.enqueue(new MockResponse().setResponseCode(403).setBody("sensitive detail"));
   ControllerApi api=new ControllerApi(server.url("/").toString(),"secret");
   try { api.list("media"); fail(); } catch(java.io.IOException error) { assertEquals("HTTP 403",error.getMessage()); }
   server.enqueue(new MockResponse().setResponseCode(302).setHeader("Location","https://example.com/"));
   try { api.list("groups"); fail(); } catch(java.io.IOException error) { assertEquals("HTTP 302",error.getMessage()); }
   assertEquals(2,server.getRequestCount());
   try { new ControllerApi("https://user:pass@example.com/","secret"); fail(); } catch(IllegalArgumentException expected) { }
  }
 }
 @Test public void apiUsesDedicatedRoutesBearerAndExactPayload() throws Exception {
  try(MockWebServer server=new MockWebServer()) {
   server.enqueue(new MockResponse().setBody("[]")); server.enqueue(new MockResponse().setBody("{}"));
   ControllerApi api=new ControllerApi(server.url("/").toString(),"secret");
   api.list("groups"); api.control("group",ControllerCommand.parse("pause",Collections.emptyMap()));
   RecordedRequest read=server.takeRequest(); assertEquals("/api/v1/groups",read.getPath()); assertEquals("Bearer secret",read.getHeader("Authorization"));
   RecordedRequest write=server.takeRequest(); assertEquals("/api/v1/groups/group/control",write.getPath()); assertEquals("{\"action\":\"pause\"}",write.getBody().readUtf8());
  }
 }
}
