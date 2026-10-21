package local.mosaic.tv;
import static org.junit.Assert.*;
import android.app.*;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.widget.*;
import java.lang.reflect.*;
import java.util.*;
import okhttp3.mockwebserver.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class ControllerConfirmationTest {
 private Object field(Object target,String name)throws Exception {Field field=target.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(target);}
 @Test @SuppressWarnings("unchecked") public void speechAndReviewCannotSendUntilConfirmed()throws Exception {
  try(MockWebServer server=new MockWebServer();org.robolectric.android.controller.ActivityController<ControllerActivity> lifecycle=Robolectric.buildActivity(ControllerActivity.class).create()){
   server.enqueue(new MockResponse().setBody("{}"));ControllerActivity activity=lifecycle.get();
   Field api=ControllerActivity.class.getDeclaredField("api");api.setAccessible(true);api.set(activity,new ControllerApi(server.url("/").toString(),"key"));
   ((List<String>)field(activity,"groupIds")).add("group-id");
   Spinner groups=(Spinner)field(activity,"groups");groups.setAdapter(new ArrayAdapter<>(activity,android.R.layout.simple_spinner_dropdown_item,new String[]{"Lobby"}));groups.setSelection(0);
   Intent result=new Intent().putStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS,new ArrayList<>(Arrays.asList("pause")));
   activity.onActivityResult(41,Activity.RESULT_OK,result);
   assertEquals("pause",((EditText)field(activity,"transcript")).getText().toString());assertEquals(0,server.getRequestCount());
   Method review=ControllerActivity.class.getDeclaredMethod("review",String.class);review.setAccessible(true);review.invoke(activity,"pause");
   AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog();assertTrue(dialog.isShowing());assertEquals(0,server.getRequestCount());
   dialog.getButton(AlertDialog.BUTTON_NEGATIVE).performClick();assertEquals(0,server.getRequestCount());
   review.invoke(activity,"pause");ShadowAlertDialog.getLatestAlertDialog().getButton(AlertDialog.BUTTON_POSITIVE).performClick();
   Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
   RecordedRequest request=server.takeRequest(5,java.util.concurrent.TimeUnit.SECONDS);assertNotNull(request);assertEquals("/api/v1/groups/group-id/control",request.getPath());
  }
 }
}
