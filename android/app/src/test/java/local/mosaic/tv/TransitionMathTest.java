package local.mosaic.tv;
import static org.junit.Assert.*;
import org.junit.Test;
public class TransitionMathTest {
 @Test public void synchronizedFadeNeverRestartsForLateFrames(){assertEquals(1,TransitionMath.opacity("fade",1000,5000,5500,false),.001);assertEquals(.5,TransitionMath.opacity("fade",1000,5000,5500,true),.001);assertEquals(0,TransitionMath.opacity("fade",1000,5000,6200,true),.001);assertEquals(0,TransitionMath.opacity("cut",0,5000,5000,true),.001);assertEquals(1,TransitionMath.opacity("fade",1000,5000,4900,true),.001);}
}
