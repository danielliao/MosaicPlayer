package local.mosaic.tv;
import android.content.Context;
import org.robolectric.RuntimeEnvironment;
import okhttp3.mockwebserver.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class)
public class ProofReporterTest {
 @Test public void persistedQueueRetriesSameIdentityAndOnlyExplicitAckRemoves() throws Exception {
  Context c=RuntimeEnvironment.getApplication();c.getSharedPreferences("playback-proof",0).edit().clear().commit();
  try(MockWebServer server=new MockWebServer()){
   server.start();String base=server.url("/").toString().replaceAll("/$","");
   JSONObject e=new JSONObject().put("eventId","stable-event").put("endAt",System.currentTimeMillis());
   ProofReporter initial=new ProofReporter(c,new ApiClient(),base,"key","screen");initial.add(e);initial.close();
   server.enqueue(new MockResponse().setResponseCode(503));
   ProofReporter retry=new ProofReporter(c,new ApiClient(),base,"key","screen");retry.flush();RecordedRequest first=server.takeRequest(5,TimeUnit.SECONDS);assertNotNull(first);assertEquals("stable-event",new JSONObject(first.getBody().readUtf8()).getJSONArray("events").getJSONObject(0).getString("eventId"));retry.close();
   server.enqueue(new MockResponse().setBody("{\"accepted\":[\"stable-event\"],\"rejected\":[]}"));
   ProofReporter restored=new ProofReporter(c,new ApiClient(),base,"key","screen");restored.flush();assertNotNull(server.takeRequest(5,TimeUnit.SECONDS));
   // Wait for the asynchronous response persistence, bounded to avoid fixture races.
   long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
   while(System.nanoTime()<until && c.getSharedPreferences("playback-proof",0).getAll().values().stream().anyMatch(v->v.toString().contains("stable-event")))Thread.sleep(10);
   restored.close();assertTrue(c.getSharedPreferences("playback-proof",0).getAll().values().stream().noneMatch(v->v.toString().contains("stable-event")));
  }
 }
}
