package local.mosaic.tv;
import java.util.*;
import org.json.*;

/** Conservative sampled full-segment completion; a device claim, not physical exposure. */
public final class PlaybackEvidence {
  private Sample candidate;
  private boolean eligible;
  private double wrapAt=Double.NEGATIVE_INFINITY;
  public static final class Sample {
    public String mediaId,programId,control;
    public long startAt,durationMs;
    public double now;
    public boolean ready,video;
    public double positionMs,sourceDurationMs;
    public Sample(String media,String program,String control,long start,long duration,double now,boolean ready){this.mediaId=media;this.programId=program;this.control=control;this.startAt=start;this.durationMs=duration;this.now=now;this.ready=ready;}
  }
  public void reset(){candidate=null;eligible=false;wrapAt=Double.NEGATIVE_INFINITY;}
  public JSONObject observe(Sample s){
    Sample old=candidate;boolean oldEligible=eligible;candidate=null;eligible=false;
    if(!s.ready||!Double.isFinite(s.now)||s.durationMs<1000||s.durationMs>3600000||s.now<s.startAt){wrapAt=Double.NEGATIVE_INFINITY;return null;}
    boolean same=old!=null&&Objects.equals(old.mediaId,s.mediaId)&&Objects.equals(old.programId,s.programId)&&Objects.equals(old.control,s.control)&&old.startAt==s.startAt&&old.durationMs==s.durationMs;
    boolean continuous=old!=null&&s.now>=old.now&&s.now-old.now<=250&&Objects.equals(old.control,s.control);
    if(continuous&&Objects.equals(old.mediaId,s.mediaId)&&s.video&&s.sourceDurationMs>0&&old.positionMs-s.positionMs>s.sourceDurationMs/2)wrapAt=s.now;
    boolean completedVideo=old==null||!old.video||Objects.equals(old.mediaId,s.mediaId)&&s.now-wrapAt<=250&&wrapAt>=old.startAt+old.durationMs-250;
    JSONObject event=null;
    if(continuous&&completedVideo&&oldEligible&&!same){long end=old.startAt+old.durationMs;if(old.now>=end-150&&s.now>=end&&s.now<=end+150&&s.startAt==end){event=new JSONObject();Protocol.put(event,"eventId",UUID.randomUUID().toString());Protocol.put(event,"mediaId",old.mediaId);Protocol.put(event,"programId",old.programId==null?JSONObject.NULL:old.programId);Protocol.put(event,"startAt",old.startAt);Protocol.put(event,"endAt",end);Protocol.put(event,"durationMs",old.durationMs);}}
    boolean boundary=continuous&&old.startAt+old.durationMs==s.startAt&&old.now>=s.startAt-150&&s.now-s.startAt<=150;
    eligible=same&&continuous?oldEligible:boundary||s.now==s.startAt;
    candidate=s;
    return event;
  }
}
