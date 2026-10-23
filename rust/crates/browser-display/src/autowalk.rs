//! One ordinary movement key per real input wait, over public map cells only.
use rogue_contract::*;
use serde_json::{Value, json};
use std::collections::VecDeque;

pub(crate) const STEP_DELAY_MS: u32 = 100;
type Point = (i32, i32);
const DIRECTIONS: [(i32, i32, u32); 8] = [
    (-1,0,RG_KEY_LEFT),(1,0,RG_KEY_RIGHT),(0,-1,RG_KEY_UP),(0,1,RG_KEY_DOWN),
    (-1,-1,RG_KEY_HOME),(1,-1,RG_KEY_PAGE_UP),(-1,1,RG_KEY_END),(1,1,RG_KEY_PAGE_DOWN),
];
fn point(v: &Value) -> Option<Point> {
    fn coordinate(v: &Value) -> Option<i32> {
        let n=v.as_f64()?;
        (n.is_finite() && n.fract()==0. && n>=i32::MIN as f64 && n<=i32::MAX as f64).then_some(n as i32)
    }
    Some((coordinate(&v["x"])?,coordinate(&v["y"])?))
}
struct Map<'a> { frame: &'a Value, cells: &'a [u8], width: i32, height: i32 }
impl<'a> Map<'a> {
    fn new(frame: &'a Value) -> Option<Self> {
        let width = i32::try_from(frame["width"].as_u64()?).ok()?;
        let height = i32::try_from(frame["height"].as_u64()?).ok()?;
        let cells = frame["map_cells"].as_str()?.as_bytes();
        (width > 0 && width <= 80 && height > 2 && height <= 24
            && cells.len() == (width*height) as usize && cells.is_ascii())
            .then_some(Self { frame, cells, width, height })
    }
    fn index(&self, p: Point) -> Option<usize> {
        (p.0 >= 0 && p.0 < self.width && p.1 > 0 && p.1 < self.height-1)
            .then_some((p.1*self.width+p.0) as usize)
    }
    fn walkable(&self, p: Point, target: Point) -> bool {
        let Some(i) = self.index(p) else { return false; };
        match self.cells[i] {
            b'.' | b'#' | b'+' | b'%' | b'^' | b'@' | b'*' | b'!' | b'?' |
            b':' | b')' | b']' | b'=' | b'/' | b',' => true,
            // A perceived monster may be the final collision, never a shortcut.
            b'A'..=b'Z' if p == target => self.frame["map_underlays"].as_array()
                .is_some_and(|a| a.iter().any(|v| point(v) == Some(p)
                    && matches!(v["tile"].as_u64(), Some(1..=3 | 6..=7)))),
            _ => false,
        }
    }
    fn next(&self, start: Point, target: Point) -> Option<(Point,u32)> {
        if start == target || !self.walkable(target,target) { return None; }
        let origin = self.index(start)?;
        let end = self.index(target)?;
        let mut previous = vec![None; self.cells.len()];
        let mut queue = VecDeque::from([start]);
        previous[origin] = Some((origin,0));
        while let Some(p) = queue.pop_front() {
            for (dx,dy,key) in DIRECTIONS {
                let next = (p.0+dx,p.1+dy);
                let Some(i) = self.index(next) else { continue; };
                if previous[i].is_some() || !self.walkable(next,target)
                    || dx != 0 && dy != 0 && (!self.walkable((p.0+dx,p.1),start)
                        || !self.walkable((p.0,p.1+dy),start)) { continue; }
                previous[i] = Some((self.index(p)?,key));
                if i == end {
                    let mut cursor = i;
                    loop {
                        let (parent,key) = previous[cursor]?;
                        if parent == origin {
                            return Some(((cursor as i32%self.width,cursor as i32/self.width),key));
                        }
                        cursor = parent;
                    }
                }
                queue.push_back(next);
            }
        }
        None
    }
}
#[derive(Default)]
pub(crate) struct AutoWalk {
    target: Option<Point>,
    epoch: Option<u64>,
    expected: Option<Point>,
    sent_request: Option<u64>,
    scheduled: Option<(u64,u64)>,
    token: u64,
    reason: &'static str,
}
impl AutoWalk {
    pub fn stop(&mut self, reason: &'static str) -> bool {
        let active = self.target.take().is_some();
        self.expected = None;
        self.sent_request = None;
        self.scheduled = None;
        if active { self.reason = reason; }
        active
    }
    pub fn active(&self) -> bool { self.target.is_some() }
    pub fn start(&mut self, frame: &Value, target: &Value) {
        self.stop("replaced");
        self.reason = "unreachable";
        let Some(target) = point(target) else { return; };
        let Some(start) = point(&frame["player"]) else { return; };
        if start == target { self.reason = "arrived"; return; }
        if Map::new(frame).and_then(|m| m.next(start,target)).is_none() { return; }
        self.target = Some(target);
        self.epoch = frame["map_actor_epoch"].as_u64();
        self.reason = "";
    }
    pub fn observe(&mut self, frame: &Value) -> bool {
        if self.active() && (frame["map_actor_epoch"].as_u64() != self.epoch
            || frame["ui"]["mode"] != "game" || frame["ui"]["window"].is_object()) {
            return self.stop("scene");
        }
        false
    }
    pub fn schedule(&mut self, frame: &Value, request: u64) -> Option<Value> {
        let target = self.target?;
        if self.sent_request == Some(request) || self.scheduled.is_some_and(|(_,r)| r == request) { return None; }
        let here = point(&frame["player"])?;
        if let Some(expected) = self.expected.take() && here != expected {
            self.stop("blocked"); return None;
        }
        if here == target { self.stop("arrived"); return None; }
        if Map::new(frame).and_then(|m| m.next(here,target)).is_none() {
            self.stop("unreachable"); return None;
        }
        self.token = self.token.wrapping_add(1);
        self.scheduled = Some((self.token,request));
        Some(json!({"kind":"autowalk-timer","token":self.token,"request":request,"delay":STEP_DELAY_MS}))
    }
    pub fn accepts_tick(&self, token: u64) -> bool {
        self.scheduled.is_some_and(|(current,_)| current == token)
    }
    pub fn tick(&mut self, frame: &Value, request: u64, token: u64) -> Option<u32> {
        if self.scheduled != Some((token,request)) { return None; }
        self.scheduled = None;
        let target = self.target?;
        let here = point(&frame["player"])?;
        let Some((next,key)) = Map::new(frame).and_then(|m| m.next(here,target)) else {
            self.stop("unreachable"); return None;
        };
        self.expected = Some(next);
        self.sent_request = Some(request);
        Some(key)
    }
    pub fn snapshot(&self) -> Value {
        json!({"active":self.active(),"target":self.target.map(|(x,y)|json!({"x":x,"y":y})),
            "reason":self.reason,"scheduled":self.scheduled.map(|(token,request)|json!({"token":token,"request":request}))})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame() -> Value {
        json!({"width":8,"height":6,"map_actor_epoch":1,"player":{"x":1,"y":2},
            "map_cells":"        |......||@.....||......||......|        ",
            "ui":{"mode":"game"}})
    }
    #[test]
    fn bounded_public_paths_and_single_request_cadence() {
        let mut f = frame(); let mut walk = AutoWalk::default();
        walk.start(&f,&json!({"x":5.0,"y":2.0}));
        let timer = walk.schedule(&f,1).unwrap();
        assert_eq!(timer["delay"],100);
        assert!(walk.schedule(&f,1).is_none());
        // A fresh manual-input boundary replaces a timer for an older wait.
        let newer=walk.schedule(&f,2).unwrap();
        assert!(walk.tick(&f,2,timer["token"].as_u64().unwrap()).is_none());
        walk.stop("input");walk.start(&f,&json!({"x":5,"y":2}));
        let timer=walk.schedule(&f,1).unwrap();
        assert!(newer["token"] != timer["token"]);
        assert_eq!(walk.tick(&f,1,99),None);
        assert_eq!(walk.tick(&f,1,timer["token"].as_u64().unwrap()),Some(RG_KEY_RIGHT));
        assert!(walk.schedule(&f,1).is_none());
        assert!(walk.schedule(&f,2).is_none());
        assert_eq!(walk.snapshot()["reason"],"blocked");
        // A blank is not traversable, even when a hidden internal corridor could exist.
        f["map_cells"] = json!("        |......||@ ....||......||......|        ");
        let map = Map::new(&f).unwrap();
        assert!(!map.walkable((2,2),(2,2)));
        walk.start(&f,&json!({"x":2,"y":2})); assert!(!walk.active());
        walk.start(&f,&json!({"x":5,"y":2})); assert!(walk.active());
        let timer=walk.schedule(&f,3).unwrap();walk.stop("input");
        assert!(walk.tick(&f,3,timer["token"].as_u64().unwrap()).is_none());
    }
    #[test]
    fn diagonal_corners_enemies_and_scene_are_public() {
        let mut f=frame();
        f["map_cells"]=json!("        |......||@|....|||.....||......|        ");
        assert_ne!(Map::new(&f).unwrap().next((1,2),(2,3)).map(|s| s.0),Some((2,3)));
        f=frame();f["map_cells"]=json!("        |......||@...A.||......||......|        ");
        let map=Map::new(&f).unwrap();assert!(!map.walkable((5,2),(5,2)));
        f["map_underlays"]=json!([{"x":5,"y":2,"tile":1}]);
        let map=Map::new(&f).unwrap();assert!(map.next((1,2),(5,2)).is_some());
        assert!(!map.walkable((5,2),(6,2)));
        let mut walk=AutoWalk::default();walk.start(&f,&json!({"x":5,"y":2}));
        f["map_actor_epoch"]=json!(2);assert!(walk.observe(&f));assert!(!walk.active());
    }
}
