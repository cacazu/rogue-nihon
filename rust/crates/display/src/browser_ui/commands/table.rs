use super::*;
struct TableRow {
    description:Vec<String>,fixed:Vec<String>,
    binding:Option<(String,Vec<keybindings::KeyBinding>)>,
    height:f64,heading:bool,
}
impl BrowserUi {
    pub(in crate::browser_ui) fn draw_commands(&mut self) {
        self.begin_choices("commands");self.regions.clear();self.map_rect=None;
        self.widgets.rect(Rect::new(0.,0.,self.width,self.height),"@overlay.strong");
        let compact=self.compact_layout();
        let width=(self.width-16.).min(860.);let table_width=width-40.;
        let key_width=if compact {table_width}else{(table_width*0.38).min(280.)};let description_width=if compact {table_width}else{table_width-key_width};
        let mut rows=Vec::new();
        let definitions=all_commands();
        for (group,entries) in GROUPS {
            let heading=self.wrap(&self.t(group),table_width-20.,16.);
            rows.push(TableRow {height:heading.len() as f64*26.+12.,description:heading,fixed:vec![],binding:None,heading:true});
            for c in definitions.iter().filter(|c|c.group==*group) {
                let description=self.wrap(&self.command_label(c.id),description_width-20.,16.);
                let bindings=self.command_bindings(c.id);
                let height=if compact {description.len() as f64*26.+bindings.len().max(1) as f64*44.+12.}else{(description.len() as f64*26.).max(bindings.len().max(1) as f64*44.)+8.};
                rows.push(TableRow {description,fixed:vec![],binding:Some((c.id.into(),bindings)),height,heading:false});
            }
            for entry in entries.iter().filter(|e|e.phone_action.is_none() && !matches!(e.keys,"commands.shift_direction"|"commands.ctrl_direction"|"Ctrl + P"|"o"|"Ctrl + R"|"v")) {
                let keys=if entry.keys.starts_with("commands.") {self.t(entry.keys)} else {entry.keys.replace("{pad}",&self.t("commands.keypad"))};
                let fixed=self.wrap(&keys,key_width-20.,16.);
                let label=if entry.description.starts_with("help.") {self.mobile_help(entry.description)} else {self.t(entry.description)};
                let description=self.wrap(&label,description_width-20.,16.);
                let height=if compact {(description.len()+fixed.len()) as f64*26.+12.}else{description.len().max(fixed.len()) as f64*26.+12.};
                rows.push(TableRow {description,fixed,binding:None,height,heading:false});
            }
        }

        let total:f64=rows.iter().map(|row|row.height).sum();
        let (panel,body)=self.sheet_layout(width,total+40.);
        let table=Rect::new(body.x,body.y,table_width,body.h);
        let viewport=Rect::new(table.x,table.y+40.,table.w,(table.h-40.).max(1.));
        self.widgets.box_rect(panel,PANEL,Some(LINE),0.);
        self.widgets.text_line(&self.t("commands.title"),Rect::new(panel.x+16.,16.,width-88.,48.),TextStyle::new(22.,TEXT,true),false,self.measure);
        self.control("commands-close",&self.t("action.cancel_short"),Rect::new(panel.x+width-56.,16.,48.,48.),json!({"kind":"commands","open":false}),ControlStyle{icon:Some("close"),icon_size:24.,shortcut:self.pc_shortcut("Escape"),..Default::default()});
        let header=Rect::new(table.x,table.y,table.w,40.);
        if compact {
            self.reference_cell(&[format!("{} / {}",self.t("commands.action"),self.t("commands.key"))],header,true);
        } else {
            self.reference_cell(&[self.t("commands.action")],Rect::new(header.x,header.y,description_width,header.h),true);
            self.reference_cell(&[self.t("commands.key")],Rect::new(header.x+description_width,header.y,key_width,header.h),true);
        }
        self.widgets.rect(Rect::new(header.x,header.y+header.h-1.,header.w,1.),LINE);
        if !compact {self.widgets.rect(Rect::new(header.x+description_width,header.y,1.,header.h),LINE);}
        let max=(total-viewport.h).max(0.);
        let offset=clamp(*self.scrolls.get("commands").unwrap_or(&0.),0.,max);
        let mut y=viewport.y-offset;
        self.widgets.begin_clip(viewport);
        for row in rows {
            if y+row.height>viewport.y && y<viewport.y+viewport.h {
                if row.heading {
                    self.reference_cell(&row.description,Rect::new(table.x,y,table.w,row.height),true);
                } else {
                    let description_height=if compact {row.description.len() as f64*26.}else{row.height};
                    self.reference_cell(&row.description,Rect::new(table.x,y,description_width,description_height),false);
                    let cell=if compact {Rect::new(table.x,y+description_height+4.,table_width,row.height-description_height-4.)}else{Rect::new(table.x+description_width,y,key_width,row.height)};
                    if let Some((id,bindings))=row.binding {
                        let count=bindings.len().max(1);
                        for index in 0..count {
                            let label=bindings.get(index).map(keybindings::KeyBinding::label).unwrap_or_else(||self.t("keybindings.unbound"));
                            let rect=Rect::new(cell.x+6.,cell.y+4.+index as f64*44.,cell.w-12.,40.);
                            if self.pc_controls() {
                                self.control(&format!("command-bind-{id}-{index}"),&label,rect,json!({"kind":"binding-edit","id":id,"index":index}),ControlStyle{size:16.,role:ControlRole::Command,..Default::default()});
                            } else {
                                self.reference_cell(&[label],rect,false);
                            }
                        }
                    } else {
                        self.reference_cell(&row.fixed,cell,false);
                    }
                    if !compact {self.widgets.rect(Rect::new(cell.x,y,1.,row.height),LINE);}
                }
                self.widgets.rect(Rect::new(table.x,y+row.height-1.,table.w,1.),LINE);
            }
            y+=row.height;
        }
        self.widgets.end_clip();self.regions.insert("commands".into(),Region{rect:viewport,max});
        self.scrolls.insert("commands".into(),offset);self.widgets.scrollbar(viewport,total,offset);
    }
}
