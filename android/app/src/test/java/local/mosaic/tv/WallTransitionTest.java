package local.mosaic.tv;
import static org.junit.Assert.*;
import android.graphics.*;
import android.view.View;
import androidx.media3.exoplayer.ExoPlayer;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.*;
@RunWith(RobolectricTestRunner.class)
@Config(sdk=28)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class WallTransitionTest {
 WallView wall() throws Exception {WallView w=new WallView(RuntimeEnvironment.getApplication());w.measure(View.MeasureSpec.makeMeasureSpec(100,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(100,View.MeasureSpec.EXACTLY));w.layout(0,0,100,100);w.configure(new JSONObject("{\"cols\":1,\"rows\":1,\"tileWidth\":100,\"tileHeight\":100}"),new JSONObject("{\"col\":0,\"row\":0}"),100,100);return w;}
 Bitmap color(int color){Bitmap b=Bitmap.createBitmap(100,100,Bitmap.Config.ARGB_8888);b.eraseColor(color);return b;}
 void layout(WallView w){w.measure(View.MeasureSpec.makeMeasureSpec(100,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(100,View.MeasureSpec.EXACTLY));w.layout(0,0,100,100);}
 @Test public void imagesBlendFrozenOutputAtSharedEpochAndLateJoinCuts() throws Exception {WallView w=wall();w.showImage(color(Color.RED));layout(w);assertTrue(w.beginTransition("fade",1000,5000));w.showImage(color(Color.BLUE));layout(w);w.transitionTick(5500);assertTrue(w.transitionVisible());Bitmap capture=w.capture();int pixel=capture.getPixel(50,50);assertTrue(Color.red(pixel)>100&&Color.blue(pixel)>100);capture.recycle();w.transitionTick(6200);assertFalse(w.transitionVisible());w.clear();}
 @Test public void videoWaitsForActualFirstFrameEvenAfterFadeWindowAndFailureKeepsSnapshot() throws Exception {WallView w=wall();w.showImage(color(Color.RED));layout(w);assertTrue(w.beginTransition("fade",1000,5000));ExoPlayer player=new ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build();try{w.showVideo(player);w.transitionTick(9000);assertTrue(w.transitionVisible());Bitmap held=w.capture();assertEquals(Color.RED,held.getPixel(50,50));held.recycle();w.clearKeepingSnapshot();assertTrue(w.transitionVisible());w.showVideo(player);w.firstFrame(player);w.transitionTick(9000);assertFalse(w.transitionVisible());}finally{w.clear();player.release();}}
 @Test public void decoderFailureAfterFirstFrameRestoresOpaqueOldOutput() throws Exception {WallView w=wall();w.showImage(color(Color.RED));layout(w);assertTrue(w.beginTransition("fade",1000,5000));ExoPlayer player=new ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build();try{w.showVideo(player);w.firstFrame(player);w.transitionTick(5500);assertFalse(w.contentReady());w.clearKeepingSnapshot();w.transitionTick(9000);assertTrue(w.transitionVisible());assertFalse(w.contentReady());Bitmap held=w.capture();assertEquals(Color.RED,held.getPixel(50,50));held.recycle();}finally{w.clear();player.release();}}
}
