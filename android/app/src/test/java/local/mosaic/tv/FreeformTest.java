package local.mosaic.tv;
import static org.junit.Assert.*;
import org.junit.Test;
import org.json.*;
public class FreeformTest {
 @Test public void rejectsOverlapsAndMalformedRects() throws Exception {
  JSONObject l=new JSONObject("{\"canvasWidth\":4280,\"canvasHeight\":1920,\"screens\":[{\"id\":\"a\",\"x\":0,\"y\":0,\"width\":1920,\"height\":1080},{\"id\":\"b\",\"x\":1920,\"y\":0,\"width\":1080,\"height\":1920,\"rotation\":90},{\"id\":\"c\",\"x\":3000,\"y\":0,\"width\":1280,\"height\":720,\"rotation\":270}]}");
  Protocol.validateFreeform(l);
  JSONObject b=l.getJSONArray("screens").getJSONObject(1);
  b.put("x",1900);assertThrows(JSONException.class,()->Protocol.validateFreeform(l));
  b.put("x",1920);b.put("rotation",45);assertThrows(JSONException.class,()->Protocol.validateFreeform(l));
  b.put("rotation",90);b.put("height",1921);assertThrows(JSONException.class,()->Protocol.validateFreeform(l));
  b.put("height",1920);b.put("id","a");assertThrows(JSONException.class,()->Protocol.validateFreeform(l));
 }
 @Test public void mixedCropAndRotations() {
  for(int rotation:new int[]{0,90,180,270}) {
   SyncMath.Crop c=SyncMath.freeformCrop(4280,1920,1920,0,1080,1920,rotation,1920,1080,4280,1920);
   double scale=rotation%180==0?1080.0/1920:1;
   assertEquals(-1920*scale,c.contentX,.001);
   assertEquals(4280*scale,c.contentWidth,.001);
   assertEquals(1080*scale,c.viewportWidth,.001);
  }
 }
}
