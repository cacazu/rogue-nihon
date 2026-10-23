//! Unsaved UI permission; original C actions and consumed journal keys remain authoritative.
use rogue_contract::target_run_permit;
use serde_json::Value;
type Point = (i32, i32);
fn point(v: &Value) -> Option<Point> {
    Some((i32::try_from(v["x"].as_i64()?).ok()?, i32::try_from(v["y"].as_i64()?).ok()?))
}
fn delta(direction: u8) -> Option<Point> {
    Some(match direction {
        b'h'=>(-1,0),b'j'=>(0,1),b'k'=>(0,-1),b'l'=>(1,0),
        b'y'=>(-1,-1),b'u'=>(1,-1),b'b'=>(-1,1),b'n'=>(1,1),_=>return None,
    })
}
#[derive(Debug, PartialEq, Eq)]
pub enum Decision { Continue, Wait, Stop }
#[derive(Default)]
pub struct Permit {
    start: Option<(u64,u32)>,
    segment: Option<Segment>,
}
struct Segment { direction:u8, remaining:u32, expected:Point, target:Point }
impl Permit {
    pub fn start(&mut self, sequence:u64, interrupt:u32) {
        self.clear();self.start=Some((sequence,interrupt));
    }
    pub fn clear(&mut self) { self.start=None;self.segment=None; }
    pub fn coalescing(&self) -> bool { self.segment.is_some() }
    pub fn grant(&mut self, raw:u32, frame:&Value, direction:u8) -> bool {
        let Some((requested,remaining))=target_run_permit(raw) else { return false; };
        let Some(here)=point(&frame["player"]) else { return false; };
        let Some((dx,dy))=delta(direction) else { return false; };
        if self.start.is_none() || requested!=direction { return false; }
        self.segment=Some(Segment{direction,remaining,expected:here,
            target:(here.0+dx*remaining as i32,here.1+dy*remaining as i32)});
        true
    }
    pub fn decision(&mut self, frame:&Value, direction:u8, sequence:u64, interrupt:u32) -> Decision {
        let Some(segment)=self.segment.as_mut() else { return Decision::Wait; };
        if self.start!=Some((sequence,interrupt)) || segment.direction!=direction
            || point(&frame["player"])!=Some(segment.expected) || frame["ui"]["mode"]!="game"
            || frame["ui"]["window"].is_object() {
            self.clear();return Decision::Stop;
        }
        if segment.remaining==0 { self.segment=None;return Decision::Wait; }
        let (dx,dy)=delta(direction).unwrap();
        let next=(segment.expected.0+dx,segment.expected.1+dy);
        if !walkable(frame,next,segment.target) || dx!=0 && dy!=0 &&
            (!walkable(frame,(segment.expected.0+dx,segment.expected.1),segment.expected)
                || !walkable(frame,(segment.expected.0,segment.expected.1+dy),segment.expected)) {
            self.clear();return Decision::Stop;
        }
        segment.expected=next;segment.remaining-=1;
        Decision::Continue
    }
}
fn walkable(frame:&Value, p:Point, target:Point)->bool {
    let Some(width)=frame["width"].as_i64().filter(|v| (1..=80).contains(v)) else {return false;};
    let Some(height)=frame["height"].as_i64().filter(|v| (3..=24).contains(v)) else {return false;};
    let Some(cells)=frame["map_cells"].as_str().filter(|v| v.is_ascii() && v.len()==(width*height) as usize) else {return false;};
    if p.0<0 || i64::from(p.0)>=width || p.1<=0 || i64::from(p.1)>=height-1 {return false;}
    match cells.as_bytes()[(i64::from(p.1)*width+i64::from(p.0)) as usize] {
        b'.'|b'#'|b'+'|b'%'|b'^'|b'@'|b'*'|b'!'|b'?'|b':'|b')'|b']'|b'='|b'/'|b','=>true,
        b'A'..=b'Z' if p==target=>frame["map_underlays"].as_array().is_some_and(|rows| rows.iter().any(|row|
            point(row)==Some(p) && matches!(row["tile"].as_u64(),Some(1..=3|6..=7)))),
        _=>false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rogue_contract::target_run_permit_key;
    use serde_json::json;
    fn frame()->Value {json!({"width":8,"height":6,"player":{"x":1,"y":2},
        "map_cells":"        |......||@.....||......||......|        ","ui":{"mode":"game"}})}
    #[test]
    fn each_original_step_is_consumed_once_and_zero_remaining_waits_without_motion() {
        for steps in [1,2] {
            let mut p=Permit::default();let mut f=frame();p.start(9,2);
            assert!(p.grant(target_run_permit_key(b'l',steps).unwrap(),&f,b'l'));
            for n in 0..steps {
                assert_eq!(p.decision(&f,b'l',9,2),Decision::Continue);
                f["player"]["x"]=json!(2+n);
            }
            assert_eq!(p.decision(&f,b'l',9,2),Decision::Wait);
            assert!(!p.coalescing());
        }
    }
    #[test]
    fn source_events_manual_interrupts_wrong_direction_and_unexpected_position_stop_before_next_step() {
        for change in 0..5 {
            let mut p=Permit::default();let mut f=frame();p.start(9,2);
            assert!(p.grant(target_run_permit_key(b'l',2).unwrap(),&f,b'l'));
            let (direction,sequence,interrupt)=match change {0=>(b'l',10,2),1=>(b'l',9,3),
                2=>(b'h',9,2),3=>{f["player"]["x"]=json!(2);(b'l',9,2)},
                _=>{f["ui"]["mode"]=json!("menu");(b'l',9,2)}};
            assert_eq!(p.decision(&f,direction,sequence,interrupt),Decision::Stop);
            assert!(!p.coalescing());
        }
    }
    #[test]
    fn hidden_or_newly_blocked_cells_and_invalid_grants_cannot_authorize_motion() {
        let mut p=Permit::default();let mut f=frame();
        assert!(!p.grant(target_run_permit_key(b'l',2).unwrap(),&f,b'l'));
        p.start(0,0);assert!(!p.grant(target_run_permit_key(b'l',2).unwrap(),&f,b'h'));
        assert!(p.grant(target_run_permit_key(b'l',2).unwrap(),&f,b'l'));
        f["map_cells"]=json!("        |......||@ ....||......||......|        ");
        assert_eq!(p.decision(&f,b'l',0,0),Decision::Stop);
        p.start(0,0);p.clear();
        assert!(!p.grant(target_run_permit_key(b'l',2).unwrap(),&frame(),b'l'));
    }
}
