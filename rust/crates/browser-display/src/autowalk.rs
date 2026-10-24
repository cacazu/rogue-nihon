//! Public-route walking, or one permission per original C run boundary.
use rogue_contract::*;
use serde_json::{Value, json};
use std::collections::VecDeque;

pub(crate) const STEP_DELAY_MS: u32 = 100;
pub(crate) const RUN_DELAY_MS: u32 = 30;
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
struct Map<'a> { frame: &'a Value, cells: &'a [u8], width: i32, height: i32, checked: Option<Vec<u16>> }
impl<'a> Map<'a> {
    fn new(frame: &'a Value) -> Option<Self> {
        let width = i32::try_from(frame["width"].as_u64()?).ok()?;
        let height = i32::try_from(frame["height"].as_u64()?).ok()?;
        let cells = frame["map_cells"].as_str()?.as_bytes();
        (width > 0 && width <= 80 && height > 2 && height <= 24
            && cells.len() == (width*height) as usize && cells.is_ascii())
            .then(|| {
                let checked=serde_json::from_value::<Vec<u16>>(frame["map_checked"].clone()).ok()
                    .filter(|checked|valid_map_checked(checked,width as usize,height as usize));
                Self {frame,cells,width,height,checked}
            })
    }
    fn index(&self, p: Point) -> Option<usize> {
        (p.0 >= 0 && p.0 < self.width && p.1 > 0 && p.1 < self.height-1)
            .then_some((p.1*self.width+p.0) as usize)
    }
    fn attack_goal(&self, p: Point) -> bool {
        let Some(i)=self.index(p) else {return false;};
        let glyph=self.cells[i];
        if !glyph.is_ascii_uppercase() {return false;}
        // Public actor identity is enough to attempt the final collision. Its
        // hidden floor/item is neither traversed nor exposed as route data.
        self.frame["map_actors"].as_array().is_some_and(|actors|actors.iter().any(|actor|
            actor["id"].as_u64().is_some_and(|id|id!=0) && point(actor)==Some(p)
                && actor["glyph"].as_u64()==Some(u64::from(glyph))))
            || self.frame["map_underlays"].as_array().is_some_and(|underlays|underlays.iter().any(|v|
                point(v)==Some(p) && matches!(v["tile"].as_u64(),Some(1..=3 | 6..=7))))
    }
    fn walkable(&self, p: Point, target: Point) -> bool {
        let Some(i)=self.index(p) else {return false;};
        matches!(self.cells[i],b'.' | b'#' | b'+' | b'%' | b'^' | b'@' | b'*' | b'!' | b'?' |
            b':' | b')' | b']' | b'=' | b'/' | b',') || p==target && self.attack_goal(p)
    }
    fn visibility(&self) -> Option<&[Value]> {
        self.frame["map_visible"].as_array().filter(|v|v.len()==self.cells.len() && v.iter().all(Value::is_boolean)).map(Vec::as_slice)
    }
    fn visible_enemy(&self) -> Option<bool> {
        let visible=self.visibility()?;
        Some(self.frame["map_actors"].as_array().is_some_and(|actors|actors.iter().any(|actor| {
            let Some(p)=point(actor) else {return false;};
            let Some(i)=self.index(p) else {return false;};
            actor["id"].as_u64().is_some_and(|id|id!=0) && visible[i]==true
                && self.cells[i].is_ascii_uppercase() && actor["glyph"].as_u64()==Some(u64::from(self.cells[i]))
        })))
    }
    fn item(&self,p:Point) -> bool {
        self.index(p).is_some_and(|i|matches!(self.cells[i],b'*'|b'!'|b'?'|b':'|b')'|b']'|b'='|b'/'|b','))
            || point(&self.frame["player"])==Some(p)
                && matches!(self.frame["map_player_surface"]["tile"].as_u64(),Some(14..=22))
    }
    fn frontier(&self,p:Point) -> u8 {
        map_unknown_mask(self.cells,self.width as usize,self.height as usize,p.0,p.1).unwrap_or(0)
    }
    fn examined(&self,p:Point,edge:u8) -> bool {
        self.index(p).zip(self.checked.as_ref()).is_some_and(|(i,checked)| {
            // Revealing neighbours only shrinks the old unknown set. A visit
            // is needed again only when an unconfirmed direction appears.
            checked[i]!=MAP_UNCHECKED && u16::from(edge)&!checked[i]==0
        })
    }
    fn reachable(&self,start:Point) -> Vec<(Point,usize)> {
        let Some(origin)=self.index(start) else {return Vec::new();};
        let mut queue=VecDeque::from([(start,0)]);
        let mut seen=vec![false;self.cells.len()];
        let mut reached=Vec::new();
        seen[origin]=true;
        while let Some((p,distance))=queue.pop_front() {
            reached.push((p,distance));
            for (dx,dy,_) in DIRECTIONS {
                let next=(p.0+dx,p.1+dy);
                let Some(i)=self.index(next) else {continue;};
                if seen[i] || !self.walkable(next,start)
                    || dx!=0 && dy!=0 && (!self.walkable((p.0+dx,p.1),start) || !self.walkable((p.0,p.1+dy),start)) {continue;}
                seen[i]=true;queue.push_back((next,distance+1));
            }
        }
        reached
    }
    fn exploration_goal(&self,start:Point,preferred:Option<Point>) -> Option<Point> {
        // Collect reachable public items first, choosing the shortest public route.
        // Frontiers compete by route distance only when no item is reachable.
        self.reachable(start).into_iter().filter_map(|(p,distance)| {
            let item=self.item(p);
            let edge=self.frontier(p);
            let information=edge.count_ones();
            (item || p!=start && information>0 && !self.examined(p,edge))
                .then_some((p,(!item,distance,std::cmp::Reverse(information),preferred!=Some(p))))
        }).min_by_key(|(_,rank)|*rank).map(|(p,_)|p)
    }
    fn stairs_goal(&self,start:Point) -> Option<Point> {
        self.reachable(start).into_iter().find_map(|(p,_)| {
            (self.index(p).is_some_and(|i|self.cells[i]==b'%')
                || p==start && self.frame["map_player_surface"]["tile"]==6).then_some(p)
        })
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
#[derive(Clone,Copy,PartialEq)]
enum ExplorationPhase { Searching, Returning }

#[derive(Default)]
pub(crate) struct AutoWalk {
    target: Option<Point>,
    exploration: Option<ExplorationPhase>,
    completion_announced: bool,
    completion_pending: bool,
    pickup_attempt: Option<Point>,
    mode: u32,
    running: bool,
    epoch: Option<u64>,
    expected: Option<Point>,
    sent_request: Option<u64>,
    scheduled: Option<(u64,u64)>,
    token: u64,
    reason: &'static str,
}
impl AutoWalk {
    pub fn stop(&mut self, reason: &'static str) -> bool {
        let active = self.target.take().is_some() || self.exploration.is_some();
        self.exploration = None;
        self.completion_announced = false;
        self.completion_pending = false;
        self.pickup_attempt = None;
        self.running = false;
        self.expected = None;
        self.sent_request = None;
        self.scheduled = None;
        if active { self.reason = reason; }
        active
    }
    pub fn active(&self) -> bool { self.target.is_some() || self.exploration.is_some() }
    pub fn uses_run(&self) -> bool { self.mode != 0 }
    pub fn same_target(&self, frame:&Value, target:&Value, mode:u32) -> bool {
        self.exploration.is_none() && self.active() && point(target)==self.target && self.mode==mode.min(2)
            && self.epoch==frame["map_actor_epoch"].as_u64()
    }
    pub fn start(&mut self, frame: &Value, target: &Value, mode: u32) {
        if self.same_target(frame,target,mode) {return;}
        self.stop("replaced");
        self.reason = "unreachable";
        let Some(target) = point(target) else { return; };
        let Some(start) = point(&frame["player"]) else { return; };
        if start == target { self.reason = "arrived"; return; }
        if Map::new(frame).and_then(|m| m.next(start,target)).is_none() { return; }
        self.mode = mode.min(2);
        self.target = Some(target);
        self.epoch = frame["map_actor_epoch"].as_u64();
        self.reason = "";
    }
    pub fn start_explore(&mut self,frame:&Value) {
        self.stop("replaced");
        self.reason="unreachable";
        let Some(map)=Map::new(frame) else {return;};
        if map.checked.is_none() {return;}
        let Some(enemy)=map.visible_enemy() else {return;};
        if enemy {self.reason="enemy";return;}
        let Some(here)=point(&frame["player"]).filter(|p|map.index(*p).is_some()) else {return;};
        self.mode=0;self.exploration=Some(ExplorationPhase::Searching);self.target=Some(here);
        self.epoch=frame["map_actor_epoch"].as_u64();self.reason="";
    }
    fn check_exploration(&mut self,frame:&Value) -> bool {
        if self.exploration.is_none() {return true;}
        match Map::new(frame).filter(|map|map.checked.is_some()).and_then(|map|map.visible_enemy()) {
            Some(false)=>true,
            Some(true)=>{self.stop("enemy");false},
            None=>{self.stop("unreachable");false},
        }
    }
    fn plan_exploration(&mut self,frame:&Value,here:Point) -> bool {
        let Some(map)=Map::new(frame) else {self.stop("unreachable");return false;};
        if self.pickup_attempt.take()==Some(here) && map.item(here) {
            self.stop("pickup");return false;
        }
        // The game-side public-map observer keeps confirmed frontiers across ordinary
        // movement, combat and restarts. Newly unknown directions reopen them.
        self.target=map.exploration_goal(here,self.target);
        if self.target.is_some() {
            self.exploration=Some(ExplorationPhase::Searching);
            return true;
        }
        if !self.completion_announced {
            self.completion_announced=true;
            self.completion_pending=true;
        }
        self.target=map.stairs_goal(here);
        if self.target.is_some_and(|target|target!=here) {
            self.exploration=Some(ExplorationPhase::Returning);
            return true;
        }
        // Stopping normally clears undelivered events. Preserve this one only
        // for the successful no-route/already-on-stairs completion boundary.
        let pending=self.completion_pending;
        self.stop("complete");
        self.completion_pending=pending;
        false
    }
    pub fn take_exploration_complete(&mut self) -> bool {
        std::mem::take(&mut self.completion_pending)
    }
    pub fn observe(&mut self, frame: &Value) -> bool {
        if self.active() && (frame["map_actor_epoch"].as_u64() != self.epoch
            || frame["ui"]["mode"] != "game" || frame["ui"]["window"].is_object()) {
            return self.stop("scene");
        }
        let active=self.active();
        self.check_exploration(frame);
        active && !self.active()
    }
    pub fn schedule(&mut self, frame: &Value, input: &Value, request: u64) -> Option<Value> {
        if !self.active() || !self.check_exploration(frame) {return None;}
        if self.sent_request == Some(request) || self.scheduled.is_some_and(|(_,r)| r == request) { return None; }
        // A run which returned to command by itself must never restart.
        if self.running && input["kind"] == "command" {
            self.stop("natural"); return None;
        }
        let here = point(&frame["player"])?;
        if let Some(expected) = self.expected.take() && here != expected {
            self.stop("blocked"); return None;
        }
        if self.exploration.is_some() && !self.plan_exploration(frame,here) {return None;}
        let target=self.target?;
        if here == target && self.exploration.is_none() { self.stop("arrived"); return None; }
        if here!=target && Map::new(frame).and_then(|m| m.next(here,target)).is_none() {
            self.stop("unreachable"); return None;
        }
        self.token = self.token.wrapping_add(1);
        self.scheduled = Some((self.token,request));
        Some(json!({"kind":"autowalk-timer","token":self.token,"request":request,"delay":if self.mode == 0 { STEP_DELAY_MS } else { RUN_DELAY_MS }}))
    }
    pub fn accepts_tick(&self, token: u64) -> bool {
        self.scheduled.is_some_and(|(current,_)| current == token)
    }
    pub fn tick(&mut self, frame: &Value, input: &Value, request: u64, token: u64) -> Option<u32> {
        if self.scheduled != Some((token,request)) { return None; }
        self.scheduled = None;
        if !self.check_exploration(frame) {return None;}
        let target = self.target?;
        let here = point(&frame["player"])?;
        if self.exploration.is_some() && here==target && Map::new(frame).is_some_and(|map|map.item(here)) {
            self.pickup_attempt=Some(here);self.expected=Some(here);self.sent_request=Some(request);
            return Some(u32::from(b','));
        }
        let Some((next,key)) = Map::new(frame).and_then(|m| m.next(here,target)) else {
            self.stop("unreachable"); return None;
        };
        let direction = match key {
            RG_KEY_LEFT => b'h', RG_KEY_DOWN => b'j', RG_KEY_UP => b'k', RG_KEY_RIGHT => b'l',
            RG_KEY_HOME => b'y', RG_KEY_PAGE_UP => b'u', RG_KEY_END => b'b', RG_KEY_PAGE_DOWN => b'n',
            _ => return None,
        };
        let emitted = if input["kind"] == "run-boundary" {
            if self.mode != 0 && input["direction"].as_u64() == Some(u64::from(direction)) {
                let map=Map::new(frame)?;
                let mut end=next;let mut steps=1;
                while steps<RG_TARGET_RUN_PERMIT_MAX_STEPS && end!=target {
                    let Some((following,next_key))=map.next(end,target) else {break;};
                    if next_key!=key {break;}
                    end=following;steps+=1;
                }
                self.expected = Some(end);
                target_run_permit_key(direction,steps)?
            } else {
                // A turn is an intentional end of this original straight run.
                // Only its subsequent ordinary command wait may start the next segment.
                self.expected = Some(here);
                self.running = false;
                RG_KEY_TARGET_RUN_STOP
            }
        } else if self.mode != 0 {
            self.expected = Some(here); // C has not moved before the first gate.
            self.running = true;
            RG_KEY_TARGET_RUN_BASE + (self.mode - 1) * 8
                + b"hjklyubn".iter().position(|d| *d == direction)? as u32
        } else {
            self.expected = Some(next);
            key
        };
        self.sent_request = Some(request);
        Some(emitted)
    }
    pub fn snapshot(&self) -> Value {
        json!({"active":self.active(),"exploring":self.exploration.is_some(),"returning":self.exploration==Some(ExplorationPhase::Returning),"mode":self.mode,"target":self.target.map(|(x,y)|json!({"x":x,"y":y})),
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
    fn repeated_map_goal_keeps_its_timer_and_inflight_request() {
        let mut f=frame();let target=json!({"x":5,"y":2});let command=json!({"kind":"command"});let mut walk=AutoWalk::default();
        walk.start(&f,&target,0);let timer=walk.schedule(&f,&command,1).unwrap();
        walk.start(&f,&target,0);
        assert_eq!(walk.snapshot()["scheduled"],json!({"token":timer["token"],"request":1}),"The same tap cannot postpone the scheduled step");
        assert_eq!(walk.tick(&f,&command,1,timer["token"].as_u64().unwrap()),Some(RG_KEY_RIGHT));
        walk.start(&f,&target,0);assert!(walk.schedule(&f,&command,1).is_none(),"The in-flight request remains owned");
        f["player"]["x"]=json!(2);assert!(walk.schedule(&f,&command,2).is_some());
        let old=walk.snapshot()["scheduled"].clone();walk.start(&f,&json!({"x":4,"y":2}),0);
        assert!(walk.snapshot()["scheduled"].is_null());assert_ne!(walk.schedule(&f,&command,2).unwrap()["token"],old["token"]);
        walk.start(&f,&json!({"x":4,"y":2}),1);assert!(walk.snapshot()["scheduled"].is_null());assert_eq!(walk.snapshot()["mode"],1);
        let mode_timer=walk.schedule(&f,&command,2).unwrap();f["map_actor_epoch"]=json!(2);walk.start(&f,&json!({"x":4,"y":2}),1);
        assert!(walk.snapshot()["scheduled"].is_null());assert_ne!(walk.schedule(&f,&command,2).unwrap()["token"],mode_timer["token"]);
    }
    #[test]
    fn repeated_map_goal_preserves_original_run_boundaries() {
        for mode in [1,2] {
            let mut f=frame();let target=json!({"x":3,"y":2});let command=json!({"kind":"command"});let boundary=json!({"kind":"run-boundary","direction":108});let mut walk=AutoWalk::default();
            walk.start(&f,&target,mode);let first=walk.schedule(&f,&command,1).unwrap();
            let start=RG_KEY_TARGET_RUN_BASE+(mode-1)*8+3;assert_eq!(walk.tick(&f,&command,1,first["token"].as_u64().unwrap()),Some(start));
            walk.start(&f,&target,mode);assert!(walk.schedule(&f,&command,1).is_none());
            let next=walk.schedule(&f,&boundary,2).unwrap();assert_eq!(walk.tick(&f,&boundary,2,next["token"].as_u64().unwrap()),target_run_permit_key(b'l',2));
            walk.start(&f,&target,mode);f["player"]["x"]=json!(3);assert!(walk.schedule(&f,&boundary,3).is_none());assert_eq!(walk.snapshot()["reason"],"arrived");
        }
    }
    #[test]
    fn public_enemy_is_a_terminal_goal_even_without_an_item_underlay() {
        let mut f=frame();f["map_cells"]=json!("        |......||@...A.||......||......|        ");
        f["map_actors"]=json!([{"id":7,"x":5,"y":2,"glyph":65}]);
        let map=Map::new(&f).unwrap();assert!(map.walkable((5,2),(5,2)),"A public enemy over an item has no terrain underlay");
        assert!(!map.walkable((5,2),(6,2)),"Enemies never become intermediate floor");assert!(map.next((1,2),(5,2)).is_some());
        for actor in [json!({"id":7,"x":4,"y":2,"glyph":65}),json!({"id":7,"x":5,"y":2,"glyph":66}),json!({"id":0,"x":5,"y":2,"glyph":65})] {
            f["map_actors"]=json!([actor]);assert!(!Map::new(&f).unwrap().walkable((5,2),(5,2)),"Only the same published enemy qualifies");
        }
        f["map_actors"]=json!([{"id":7,"x":5,"y":2,"glyph":65}]);let cells=f["map_cells"].as_str().unwrap().replace('.'," ");f["map_cells"]=json!(cells);
        assert!(Map::new(&f).unwrap().next((1,2),(5,2)).is_none(),"An enemy goal reveals no route over unknown cells");
    }
    #[test]
    fn bounded_public_paths_and_single_request_cadence() {
        let mut f = frame(); let mut walk = AutoWalk::default();
        walk.start(&f,&json!({"x":5.0,"y":2.0}),0);
        let timer = walk.schedule(&f,&json!({"kind":"command"}),1).unwrap();
        assert_eq!(timer["delay"],100);
        assert!(walk.schedule(&f,&json!({"kind":"command"}),1).is_none());
        // A fresh manual-input boundary replaces a timer for an older wait.
        let newer=walk.schedule(&f,&json!({"kind":"command"}),2).unwrap();
        assert!(walk.tick(&f,&json!({"kind":"command"}),2,timer["token"].as_u64().unwrap()).is_none());
        walk.stop("input");walk.start(&f,&json!({"x":5,"y":2}),0);
        let timer=walk.schedule(&f,&json!({"kind":"command"}),1).unwrap();
        assert!(newer["token"] != timer["token"]);
        assert_eq!(walk.tick(&f,&json!({"kind":"command"}),1,99),None);
        assert_eq!(walk.tick(&f,&json!({"kind":"command"}),1,timer["token"].as_u64().unwrap()),Some(RG_KEY_RIGHT));
        assert!(walk.schedule(&f,&json!({"kind":"command"}),1).is_none());
        assert!(walk.schedule(&f,&json!({"kind":"command"}),2).is_none());
        assert_eq!(walk.snapshot()["reason"],"blocked");
        // A blank is not traversable, even when a hidden internal corridor could exist.
        f["map_cells"] = json!("        |......||@ ....||......||......|        ");
        let map = Map::new(&f).unwrap();
        assert!(!map.walkable((2,2),(2,2)));
        walk.start(&f,&json!({"x":2,"y":2}),0); assert!(!walk.active());
        walk.start(&f,&json!({"x":5,"y":2}),0); assert!(walk.active());
        let timer=walk.schedule(&f,&json!({"kind":"command"}),3).unwrap();walk.stop("input");
        assert!(walk.tick(&f,&json!({"kind":"command"}),3,timer["token"].as_u64().unwrap()).is_none());
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
        let mut walk=AutoWalk::default();walk.start(&f,&json!({"x":5,"y":2}),0);
        f["map_actor_epoch"]=json!(2);assert!(walk.observe(&f));assert!(!walk.active());
    }
    fn fire(walk: &mut AutoWalk, f: &Value, input: &Value, request: u64) -> Option<u32> {
        let timer=walk.schedule(f,input,request)?;
        walk.tick(f,input,request,timer["token"].as_u64().unwrap())
    }
    #[test]
    fn straight_runs_request_one_bounded_permit_for_exactly_zero_one_or_two_cells() {
        let command=json!({"kind":"command"});
        let boundary=json!({"kind":"run-boundary","direction":108});
        for mode in [1,2] {
            let f=frame();
            let mut zero=AutoWalk::default();
            zero.start(&f,&json!({"x":1,"y":2}),mode);
            assert_eq!(fire(&mut zero,&f,&command,1),None);
            assert_eq!(zero.snapshot()["reason"],"arrived");
            for steps in [1,2] {
                let mut walk=AutoWalk::default();
                walk.start(&f,&json!({"x":1+steps,"y":2}),mode);
                assert_eq!(fire(&mut walk,&f,&command,1),Some(RG_KEY_TARGET_RUN_BASE+(mode-1)*8+3));
                // Starting the original C run has moved zero cells.
                assert_eq!(fire(&mut walk,&f,&boundary,2),target_run_permit_key(b'l',steps));
                let mut arrived=f.clone();arrived["player"]["x"]=json!(1+steps);
                assert_eq!(fire(&mut walk,&arrived,&boundary,3),None);
                assert_eq!(walk.snapshot()["reason"],"arrived");
            }
        }
    }
    #[test]
    fn run_starts_without_motion_then_grants_a_straight_segment() {
        let command=json!({"kind":"command"});
        let boundary=json!({"kind":"run-boundary","direction":108});
        for mode in [1,2] {
            let mut f=frame();let mut walk=AutoWalk::default();
            walk.start(&f,&json!({"x":3,"y":2}),mode);
            assert_eq!(fire(&mut walk,&f,&command,1),Some(RG_KEY_TARGET_RUN_BASE+(mode-1)*8+3));
            assert_eq!(fire(&mut walk,&f,&boundary,2),target_run_permit_key(b'l',2));
            f["player"]["x"]=json!(3);
            assert_eq!(fire(&mut walk,&f,&boundary,3),None);
            assert_eq!(walk.snapshot()["reason"],"arrived");
        }
    }
    #[test]
    fn turns_require_stop_and_new_command_but_natural_stops_never_restart() {
        let f=frame();let mut walk=AutoWalk::default();
        let command=json!({"kind":"command"});
        walk.start(&f,&json!({"x":5,"y":2}),2);
        let start=RG_KEY_TARGET_RUN_BASE+8+3;
        assert_eq!(fire(&mut walk,&f,&command,1),Some(start));
        assert_eq!(fire(&mut walk,&f,&json!({"kind":"run-boundary","direction":104}),2),Some(RG_KEY_TARGET_RUN_STOP));
        assert_eq!(fire(&mut walk,&f,&command,3),Some(start));
        assert_eq!(fire(&mut walk,&f,&command,4),None);
        assert_eq!(walk.snapshot()["reason"],"natural");
        assert!(!walk.active());
    }
    #[test]
    fn unexpected_original_movement_cancels_next_permission() {
        let mut f=frame();let mut walk=AutoWalk::default();
        let command=json!({"kind":"command"});
        let gate=json!({"kind":"run-boundary","direction":108});
        walk.start(&f,&json!({"x":5,"y":2}),1);
        assert!(fire(&mut walk,&f,&command,1).is_some());
        assert_eq!(fire(&mut walk,&f,&gate,2),target_run_permit_key(b'l',4));
        f["player"]=json!({"x":2,"y":3});
        assert_eq!(fire(&mut walk,&f,&gate,3),None);
        assert_eq!(walk.snapshot()["reason"],"blocked");
    }

}

#[cfg(test)]
mod exploration_tests {
    use super::*;
    fn frame(rows: &[&str], player: Point) -> Value {
        let width=rows[0].len();
        json!({"width":width,"height":rows.len(),"map_actor_epoch":1,
            "player":{"x":player.0,"y":player.1},"map_cells":rows.join(""),
            "map_checked":vec![MAP_UNCHECKED;width*rows.len()],
            "map_visible":vec![true;width*rows.len()],"map_actors":[],"ui":{"mode":"game"}})
    }
    fn confirm(f:&mut Value,p:Point) {
        let map=Map::new(f).unwrap();let index=map.index(p).unwrap();let mask=map.frontier(p);
        f["map_checked"][index]=json!(mask);
    }
    fn fire(walk:&mut AutoWalk,f:&mut Value,request:u64)->Option<u32> {
        // Synthetic frames stand in for the C-side public observer in these
        // planner tests. Production receives this knowledge from ObservedMap.
        confirm(f,point(&f["player"]).unwrap());
        let command=json!({"kind":"command"});
        let timer=walk.schedule(f,&command,request)?;
        walk.tick(f,&command,request,timer["token"].as_u64().unwrap())
    }
    #[test]
    fn exploration_prioritizes_known_items_and_uses_the_existing_single_timer() {
        let mut f=frame(&["       ","|.....|","|@.!..|","|... .|","       "],(1,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT));
        assert!(fire(&mut walk,&mut f,1).is_none());
        f["player"]["x"]=json!(2);
        assert_eq!(fire(&mut walk,&mut f,2),Some(RG_KEY_RIGHT));
        f["player"]["x"]=json!(3);f["map_cells"]=json!("       |.....||..@..||... .|       ");
        assert!(fire(&mut walk,&mut f,3).is_some(),"Other public frontiers are still explored");
        walk.stop("input");assert!(!walk.active());
    }
    #[test]
    fn exploration_never_walks_unknown_cells_and_stops_on_uncollected_items() {
        let mut f=frame(&["     ","|@! |","     "],(1,1));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT));
        f["player"]["x"]=json!(2);f["map_cells"]=json!("     |.@ |     ");
        f["map_player_surface"]=json!({"tile":15});
        assert_eq!(fire(&mut walk,&mut f,2),Some(44),"Retry pickup once after automatic pickup failed");
        assert_eq!(fire(&mut walk,&mut f,3),None);assert_eq!(walk.snapshot()["reason"],"pickup");
        assert!(!walk.active());
        walk.start_explore(&f);assert_eq!(fire(&mut walk,&mut f,4),Some(44),"Explicit restart retries after manual inventory changes");
        f["map_player_surface"]=json!({"tile":1});
        assert_eq!(fire(&mut walk,&mut f,5),None);assert_eq!(walk.snapshot()["reason"],"complete");
    }
    #[test]
    fn exploration_checks_visible_actors_on_start_and_before_queued_step() {
        let mut f=frame(&["       ","|@!..A|","       "],(1,1));
        f["map_actors"]=json!([{"id":9,"x":5,"y":1,"glyph":65}]);
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert!(!walk.active());assert_eq!(walk.snapshot()["reason"],"enemy");
        f["map_visible"][12]=json!(false);walk.start_explore(&f);
        let command=json!({"kind":"command"});let timer=walk.schedule(&f,&command,1).unwrap();
        f["map_visible"][12]=json!(true);
        assert_eq!(walk.tick(&f,&command,1,timer["token"].as_u64().unwrap()),None);
        assert_eq!(walk.snapshot()["reason"],"enemy");
        f["map_visible"]=json!([]);walk.start_explore(&f);assert!(!walk.active());
    }
    #[test]
    fn exploration_replans_when_new_public_terrain_reveals_another_branch() {
        let mut f=frame(&["       ","|@..  |","       "],(1,1));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT));
        f["player"]["x"]=json!(2);f["map_cells"]=json!("       |.@.  |       ");
        assert_eq!(fire(&mut walk,&mut f,2),Some(RG_KEY_RIGHT));
        f["player"]["x"]=json!(3);f["map_cells"]=json!("       |..@.!|       ");
        assert_eq!(fire(&mut walk,&mut f,3),Some(RG_KEY_RIGHT));
        f["player"]["x"]=json!(4);
        assert_eq!(fire(&mut walk,&mut f,4),Some(RG_KEY_RIGHT));
        f["player"]["x"]=json!(5);f["map_cells"]=json!("       |....@|       ");
        for request in 5..30 {
            let Some(key)=fire(&mut walk,&mut f,request) else {break;};
            f["player"]["x"]=json!(f["player"]["x"].as_i64().unwrap()+if key==RG_KEY_LEFT {-1}else{1});
        }
        assert!(!walk.active());assert_eq!(walk.snapshot()["reason"],"complete");
    }
    #[test]
    fn exploration_item_priority_collects_distant_item_before_near_frontier() {
        let mut f=frame(&["           ","-----------","|!....@.  |","-----------","           "],(6,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_LEFT),"The reachable five-step item precedes the one-step frontier");
    }
    #[test]
    fn exploration_ranks_equal_distance_items_then_information_then_existing_goal() {
        let mut f=frame(&["         ","---------","| .@!...|","---------","         "],(3,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT),"An item wins at equal walking distance");
        let mut f=frame(&["         ","---------","| .@.   |","---------","         "],(3,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        walk.target=Some((4,2));
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT),"An equally useful existing goal wins over direction order");
    }
    #[test]
    fn exploration_completion_returns_to_the_nearest_reachable_stairs_and_never_descends() {
        let mut f=frame(&["           ","-----------","|%..@.%|! |","-----------","           "],(4,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT));
        assert_eq!(walk.snapshot()["returning"],true);
        f["player"]["x"]=json!(5);
        assert_eq!(fire(&mut walk,&mut f,2),Some(RG_KEY_RIGHT));
        f["player"]["x"]=json!(6);f["map_player_surface"]=json!({"tile":6});
        assert_eq!(fire(&mut walk,&mut f,3),None);
        assert_eq!(walk.snapshot()["reason"],"complete");assert!(!walk.active());
        assert_eq!(fire(&mut walk,&mut f,4),None,"Stairs are never activated automatically");
    }
    #[test]
    fn exploration_completion_without_reachable_stairs_or_on_stairs_emits_no_input() {
        for (row,surface) in [("|.@.|%|",1),("|.@.| |",6),("|.@.| |",1)] {
            let mut f=frame(&["       ","-------",row,"-------","       "],(2,2));
            f["map_player_surface"]=json!({"tile":surface});
            let mut walk=AutoWalk::default();walk.start_explore(&f);
            assert_eq!(fire(&mut walk,&mut f,1),None);assert_eq!(walk.snapshot()["reason"],"complete");
            assert!(walk.take_exploration_complete());assert!(!walk.take_exploration_complete());
        }
    }
    #[test]
    fn exploration_return_still_checks_enemies_and_resumes_new_public_items() {
        let mut f=frame(&["         ","---------","|@...%. |","---------","         "],(1,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        // The unchanged blank next to the known dead end has already been examined.
        confirm(&mut f,(6,2));
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT));
        assert_eq!(walk.snapshot()["returning"],true);
        f["player"]["x"]=json!(2);f["map_cells"]=json!("         ---------|!@..%. |---------         ");
        assert_eq!(fire(&mut walk,&mut f,2),Some(RG_KEY_LEFT),"A newly public item interrupts the return path");
        f["player"]["x"]=json!(1);f["map_cells"]=json!("         ---------|@...%. |---------         ");
        assert_eq!(fire(&mut walk,&mut f,3),Some(RG_KEY_RIGHT));
        assert_eq!(walk.snapshot()["returning"],true);
        f["map_cells"]=json!("         ---------|@A..%. |---------         ");
        f["map_actors"]=json!([{"id":9,"x":2,"y":2,"glyph":65}]);
        assert_eq!(fire(&mut walk,&mut f,4),None);assert_eq!(walk.snapshot()["reason"],"enemy");
    }

    #[test]
    fn exploration_distance_precedes_information_and_information_precedes_goal_stability() {
        let mut f=frame(&["         ","---------","|@!.... |","---------","         "],(1,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT),"A nearby item precedes a distant frontier");
        let mut f=frame(&["         ","---------","|.... ..|","| .@. ..|","|.......|","---------","         "],(3,3));
        let mut walk=AutoWalk::default();walk.start_explore(&f);walk.target=Some((2,3));
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT),"At equal distance a frontier revealing more neighbors replaces the left goal");
        let mut f=frame(&["         ","---------","| .@..  |","---------","         "],(3,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);walk.target=Some((5,2));
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_LEFT),"A one-step frontier wins over a two-step existing goal");
    }
    #[test]
    fn exploration_completion_event_is_once_per_run_and_abort_discards_pending_notice() {
        let mut f=frame(&["         ","---------","|@...%. |","---------","         "],(1,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        confirm(&mut f,(6,2));
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT));
        assert!(walk.take_exploration_complete());assert!(!walk.take_exploration_complete());
        f["player"]["x"]=json!(2);f["map_cells"]=json!("         ---------|!@..%. |---------         ");
        assert_eq!(fire(&mut walk,&mut f,2),Some(RG_KEY_LEFT));
        assert!(!walk.take_exploration_complete());
        f["player"]["x"]=json!(1);f["map_cells"]=json!("         ---------|@...%. |---------         ");
        assert_eq!(fire(&mut walk,&mut f,3),Some(RG_KEY_RIGHT));
        assert!(!walk.take_exploration_complete(),"A return interrupted by new loot does not announce twice");
        walk.stop("input");
        walk.start_explore(&f);confirm(&mut f,(6,2));
        assert!(walk.schedule(&f,&json!({"kind":"command"}),4).is_some());
        walk.stop("input");assert!(!walk.take_exploration_complete(),"Abort cannot leak an undelivered completion");
        let mut f=frame(&["       ","-------","|.@.| |","-------","       "],(2,2));
        for request in [5,6] {
            walk.start_explore(&f);assert_eq!(fire(&mut walk,&mut f,request),None);
            assert!(walk.take_exploration_complete());assert!(!walk.take_exploration_complete());
        }
    }
    #[test]
    fn exploration_return_keeps_diagonal_corners_and_manual_timer_cancellation() {
        let mut f=frame(&["       ","-------","|@|...|","||.%..|","-------","       "],(1,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),None,"A stair behind an inaccessible diagonal corner is unreachable");
        assert!(walk.take_exploration_complete());
        f=frame(&["       ","-------","|@..%.|","-------","       "],(1,2));
        walk.start_explore(&f);let command=json!({"kind":"command"});
        let timer=walk.schedule(&f,&command,2).unwrap();assert_eq!(walk.snapshot()["returning"],true);
        walk.stop("input");
        assert_eq!(walk.tick(&f,&command,2,timer["token"].as_u64().unwrap()),None);
        assert_eq!(walk.snapshot()["reason"],"input");
    }

    #[test]
    fn exploration_return_reopens_when_new_public_terrain_changes_an_examined_frontier() {
        let mut f=frame(&["         ","---------","|@...%. |","|       |","---------","         "],(1,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        for x in 1..=6 {confirm(&mut f,(x,2));}
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT));assert_eq!(walk.snapshot()["returning"],true);
        assert!(walk.take_exploration_complete());
        f["player"]["x"]=json!(2);f["map_cells"]=json!(["         ","---------","|.@..%. |","| .     |","---------","         "].join(""));
        assert!(fire(&mut walk,&mut f,2).is_some());
        assert_eq!(walk.snapshot()["returning"],false,"New public floor reopens exploration during the stair return");
        assert_ne!(walk.snapshot()["target"],json!({"x":5,"y":2}));assert!(!walk.take_exploration_complete());
    }

    #[test]
    fn normal_adventure_restarted_exploration_collects_scroll_before_retracing_known_door() {
        // Captured from the normal distributed game, after combat and potion
        // pickup. The nearby door and corridor were already stood on publicly.
        let case:Value=serde_json::from_str(include_str!("../../../../tests/data/autoexplore-normal-potion.json")).unwrap();
        let rows:Vec<_>=case["rows"].as_array().unwrap().iter().map(|row|row.as_str().unwrap()).collect();
        let mut f=frame(&rows,point(&case["player"]).unwrap());
        let mut checked=vec![256u16;80*24];
        for entry in case["checked"].as_array().unwrap() {
            checked[entry[0].as_u64().unwrap() as usize]=entry[1].as_u64().unwrap() as u16;
        }
        f["map_checked"]=json!(checked);
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_DOWN),"Collect the three-step scroll rather than return to the two-step already-observed door");
        assert_eq!(walk.snapshot()["target"],json!({"x":47,"y":13}));
    }

    #[test]
    fn exploration_item_priority_uses_shortest_public_route_between_items() {
        let mut f=frame(&["             ","-------------","|@.|!.......|","|..|........|","|...........|","|!..........|","-------------","             "],(1,2));
        // The item at (4,2) is geometrically close but needs a public detour.
        // The nearer reachable item remains eligible outside current sight.
        f["map_visible"][5*13+1]=json!(false);
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_DOWN));
        assert_eq!(walk.snapshot()["target"],json!({"x":1,"y":5}));
    }
    #[test]
    fn exploration_item_priority_without_items_uses_nearest_frontier() {
        let mut f=frame(&["         ","---------","| .@..  |","---------","         "],(3,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_LEFT));
        assert_eq!(walk.snapshot()["target"],json!({"x":2,"y":2}));
    }
    #[test]
    fn exploration_item_priority_excludes_unreachable_items() {
        let mut f=frame(&["           ","-----------","|!|@..  | |","-----------","           "],(3,2));
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_RIGHT));
        assert_eq!(walk.snapshot()["target"],json!({"x":5,"y":2}));
    }
    #[test]
    fn exploration_item_priority_reselects_after_each_pickup_then_explores() {
        let mut f=frame(&["           ","-----------","|!..@.!.. |","-----------","           "],(4,2));
        assert_eq!(Map::new(&f).unwrap().exploration_goal((4,2),None),Some((6,2)));
        f["player"]["x"]=json!(6);f["map_cells"]=json!(["           ","-----------","|!....@.. |","-----------","           "].join(""));
        assert_eq!(Map::new(&f).unwrap().exploration_goal((6,2),Some((6,2))),Some((1,2)),"After pickup the remaining item wins over a closer frontier");
        f["player"]["x"]=json!(1);f["map_cells"]=json!(["           ","-----------","|@....... |","-----------","           "].join(""));
        assert_eq!(Map::new(&f).unwrap().exploration_goal((1,2),Some((1,2))),Some((8,2)),"Only after the last reachable item is collected is a frontier selected");
    }

    #[test]
    fn normal_adventure_doorway_does_not_return_to_corridor_after_room_reveal() {
        // Five public positions exposed the old out/in detour. Entering the
        // room removes unknown neighbours of the corridor (227 -> 35).
        let case:Value=serde_json::from_str(include_str!("../../../../tests/data/autoexplore-normal-doorway.json")).unwrap();
        let before:Vec<_>=case["before_rows"].as_array().unwrap().iter().map(|row|row.as_str().unwrap()).collect();
        let entered:Vec<_>=case["entered_rows"].as_array().unwrap().iter().map(|row|row.as_str().unwrap()).collect();
        let mut f=frame(&before,point(&case["before_player"]).unwrap());
        for entry in case["checked"].as_array().unwrap() {
            f["map_checked"][entry[0].as_u64().unwrap() as usize]=entry[1].clone();
        }
        let mut walk=AutoWalk::default();walk.start_explore(&f);
        assert_eq!(fire(&mut walk,&mut f,1),Some(RG_KEY_DOWN));
        f["player"]=case["entered_player"].clone();f["map_cells"]=json!(entered.join(""));
        let map=Map::new(&f).unwrap();
        assert_eq!(map.frontier((19,10)),35);
        assert_eq!(f["map_checked"][10*80+19],227);
        assert_eq!(fire(&mut walk,&mut f,2),Some(RG_KEY_DOWN),"Continue into the newly revealed room instead of stepping back out");
        assert_eq!(walk.snapshot()["target"],json!({"x":17,"y":14}));
    }

    #[test]
    fn exploration_reopens_checked_position_only_for_new_unknown_directions() {
        let mut f=frame(&["         ","---------","|@... . |","---------","         "],(1,2));
        confirm(&mut f,(4,2));
        let saved=Map::new(&f).unwrap().frontier((4,2));
        assert_eq!(saved,2);
        f["map_cells"]=json!(["         ","---------","|@..... |","---------","         "].join(""));
        assert!(Map::new(&f).unwrap().examined((4,2),0),"Revealed neighbours do not require visiting the old position again");
        f["map_cells"]=json!(["         ","---------","|@. ... |","---------","         "].join(""));
        let map=Map::new(&f).unwrap();
        assert_eq!(map.frontier((4,2)),1);
        assert!(!map.examined((4,2),1),"A newly unknown direction still makes the position eligible");
        f["map_checked"][2*9+4]=json!(MAP_UNCHECKED);
        assert!(!Map::new(&f).unwrap().examined((4,2),0),"The unvisited sentinel never becomes a confirmed pattern");
    }

}
