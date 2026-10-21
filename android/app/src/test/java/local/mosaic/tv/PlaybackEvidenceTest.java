package local.mosaic.tv;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
public class PlaybackEvidenceTest {
 @Test public void videoRequiresActualLoopNotOnlyScheduledTime(){for(boolean wraps:new boolean[]{false,true}){PlaybackEvidence t=new PlaybackEvidence();int count=0;for(int n=0;n<=1000;n+=100){PlaybackEvidence.Sample s=new PlaybackEvidence.Sample("v","p","p",n/1000*1000,1000,n,true);s.video=true;s.sourceDurationMs=1000;s.positionMs=wraps?n%1000:Math.min(n,950);if(t.observe(s)!=null)count++;}assertEquals(wraps?1:0,count);}}
 @Test public void repeatedAssetSegmentsCompleteOnce(){PlaybackEvidence t=new PlaybackEvidence();int count=0;for(int n=0;n<=3000;n+=100){JSONObject e=t.observe(new PlaybackEvidence.Sample("same","p","p",n/1000*1000,1000,n,true));if(e!=null){assertEquals(count*1000,e.optLong("startAt"));count++;}}assertEquals(3,count);}
 @Test public void pausesSeeksGapsAndPartialJoinsExcluded(){for(int scenario=0;scenario<4;scenario++){PlaybackEvidence t=new PlaybackEvidence();int count=0;for(int n=scenario==0?100:0;n<=1000;n+=100){if(scenario==2&&n>=400&&n<=700)continue;if(t.observe(new PlaybackEvidence.Sample("a","p",scenario==3&&n>=500?"new":"p",n/1000*1000,1000,n,!(scenario==1&&n==500)))!=null)count++;}assertEquals(0,count);}}
}
