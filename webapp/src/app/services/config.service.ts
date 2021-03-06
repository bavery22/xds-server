import { Injectable, OnInit } from '@angular/core';
import { Http, Headers, RequestOptionsArgs, Response } from '@angular/http';
import { Location } from '@angular/common';
import { CookieService } from 'ngx-cookie';
import { Observable } from 'rxjs/Observable';
import { Subscriber } from 'rxjs/Subscriber';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';

// Import RxJs required methods
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/catch';
import 'rxjs/add/observable/throw';
import 'rxjs/add/operator/mergeMap';


import { XDSServerService, IXDSFolderConfig } from "../services/xdsserver.service";
import { XDSAgentService } from "../services/xdsagent.service";
import { SyncthingService, ISyncThingProject, ISyncThingStatus } from "../services/syncthing.service";
import { AlertService, IAlert } from "../services/alert.service";
import { UtilsService } from "../services/utils.service";

export enum ProjectType {
    NATIVE_PATHMAP = 1,
    SYNCTHING = 2
}

export var ProjectTypes = [
    { value: ProjectType.NATIVE_PATHMAP, display: "Path mapping" },
    { value: ProjectType.SYNCTHING, display: "Cloud Sync" }
];

export var ProjectStatus = {
    ErrorConfig: "ErrorConfig",
    Disable: "Disable",
    Enable: "Enable",
    Pause: "Pause",
    Syncing: "Syncing"
};

export interface IProject {
    id?: string;
    label: string;
    pathClient: string;
    pathServer?: string;
    type: ProjectType;
    status?: string;
    isInSync?: boolean;
    isUsable?: boolean;
    serverPrjDef?: IXDSFolderConfig;
    isExpanded?: boolean;
    visible?: boolean;
    defaultSdkID?: string;
}

export interface IXDSAgentConfig {
    URL: string;
    retry: number;
}

export interface ILocalSTConfig {
    ID: string;
    URL: string;
    retry: number;
    tilde: string;
}

export interface IxdsAgentPackage {
    os: string;
    arch: string;
    version: string;
    url: string;
}

export interface IConfig {
    xdsServerURL: string;
    xdsAgent: IXDSAgentConfig;
    xdsAgentPackages: IxdsAgentPackage[];
    projectsRootDir: string;
    projects: IProject[];
    localSThg: ILocalSTConfig;
}

@Injectable()
export class ConfigService {

    public conf: Observable<IConfig>;

    private confSubject: BehaviorSubject<IConfig>;
    private confStore: IConfig;
    private AgentConnectObs = null;
    private stConnectObs = null;

    constructor(private _window: Window,
        private cookie: CookieService,
        private xdsServerSvr: XDSServerService,
        private xdsAgentSvr: XDSAgentService,
        private stSvr: SyncthingService,
        private alert: AlertService,
        private utils: UtilsService,
    ) {
        this.load();
        this.confSubject = <BehaviorSubject<IConfig>>new BehaviorSubject(this.confStore);
        this.conf = this.confSubject.asObservable();

        // force to load projects
        this.loadProjects();
    }

    // Load config
    load() {
        // Try to retrieve previous config from cookie
        let cookConf = this.cookie.getObject("xds-config");
        if (cookConf != null) {
            this.confStore = <IConfig>cookConf;
        } else {
            // Set default config
            this.confStore = {
                xdsServerURL: this._window.location.origin + '/api/v1',
                xdsAgent: {
                    URL: 'http://localhost:8010',
                    retry: 10,
                },
                xdsAgentPackages: [],
                projectsRootDir: "",
                projects: [],
                localSThg: {
                    ID: null,
                    URL: "http://localhost:8386",
                    retry: 10,    // 10 seconds
                    tilde: "",
                }
            };
        }

        // Update XDS Agent tarball url
        this.xdsServerSvr.getXdsAgentInfo().subscribe(nfo => {
            this.confStore.xdsAgentPackages = [];
            nfo.tarballs && nfo.tarballs.forEach(el =>
                this.confStore.xdsAgentPackages.push({
                    os: el.os,
                    arch: el.arch,
                    version: el.version,
                    url: el.fileUrl
                })
            );
            this.confSubject.next(Object.assign({}, this.confStore));
        });

        // Update Project data
        this.xdsServerSvr.FolderStateChange$.subscribe(prj => {
            let i = this._getProjectIdx(prj.id);
            if (i >= 0) {
                // XXX for now, only isInSync and status may change
                this.confStore.projects[i].isInSync = prj.isInSync;
                this.confStore.projects[i].status = prj.status;
                this.confStore.projects[i].isUsable = this._isUsableProject(prj);
                this.confSubject.next(Object.assign({}, this.confStore));
            }
        });
    }

    // Save config into cookie
    save() {
        // Notify subscribers
        this.confSubject.next(Object.assign({}, this.confStore));

        // Don't save projects in cookies (too big!)
        let cfg = Object.assign({}, this.confStore);
        delete (cfg.projects);
        this.cookie.putObject("xds-config", cfg);
    }

    loadProjects() {
        // Setup connection with local XDS agent
        if (this.AgentConnectObs) {
            try {
                this.AgentConnectObs.unsubscribe();
            } catch (err) { }
            this.AgentConnectObs = null;
        }

        let cfg = this.confStore.xdsAgent;
        this.AgentConnectObs = this.xdsAgentSvr.connect(cfg.retry, cfg.URL)
            .subscribe((sts) => {
                //console.log("Agent sts", sts);
                // FIXME: load projects from local XDS Agent and
                //  not directly from local syncthing
                this._loadProjectFromLocalST();

            }, error => {
                if (error.indexOf("XDS local Agent not responding") !== -1) {
                    let rootUrl = "http://docs.automotivelinux.org/docs/devguides/en/dev/reference/";
                    let url_OS_Linux = rootUrl + "xds/part-1/1_install-client.html#install-packages-for-debian-distro-type";
                    let url_OS_Other = rootUrl + "xds/part-1/1_install-client.html#install-for-other-platforms-windows--macos";
                    let msg = `<span><strong>` + error + `<br></strong>
                    You may need to install and execute XDS-Agent: <br>
                        On Linux machine <a href="` + url_OS_Linux + `" target="_blank"><span
                            class="fa fa-external-link"></span></a>
                        <br>
                        On Windows machine <a href="` + url_OS_Other + `" target="_blank"><span
                            class="fa fa-external-link"></span></a>
                        <br>
                        On MacOS machine <a href="` + url_OS_Other + `" target="_blank"><span
                            class="fa fa-external-link"></span></a>
                    `;
                    this.alert.error(msg);
                } else {
                    this.alert.error(error);
                }
            });
    }

    private _loadProjectFromLocalST() {
        // Remove previous subscriber if existing
        if (this.stConnectObs) {
            try {
                this.stConnectObs.unsubscribe();
            } catch (err) { }
            this.stConnectObs = null;
        }

        // FIXME: move this code and all logic about syncthing inside XDS Agent
        // Setup connection with local SyncThing
        let retry = this.confStore.localSThg.retry;
        let url = this.confStore.localSThg.URL;
        this.stConnectObs = this.stSvr.connect(retry, url).subscribe((sts) => {
            this.confStore.localSThg.ID = sts.ID;
            this.confStore.localSThg.tilde = sts.tilde;
            if (this.confStore.projectsRootDir === "") {
                this.confStore.projectsRootDir = sts.tilde;
            }

            // Rebuild projects definition from local and remote syncthing
            this.confStore.projects = [];

            this.xdsServerSvr.getProjects().subscribe(remotePrj => {
                this.stSvr.getProjects().subscribe(localPrj => {
                    remotePrj.forEach(rPrj => {
                        let lPrj = localPrj.filter(item => item.id === rPrj.id);
                        if (lPrj.length > 0 || rPrj.type === ProjectType.NATIVE_PATHMAP) {
                            this._addProject(rPrj, true);
                        }
                    });
                    this.confSubject.next(Object.assign({}, this.confStore));
                }), error => this.alert.error('Could not load initial state of local projects.');
            }), error => this.alert.error('Could not load initial state of remote projects.');

        }, error => {
            if (error.indexOf("Syncthing local daemon not responding") !== -1) {
                let msg = "<span><strong>" + error + "<br></strong>";
                msg += "Please check that local XDS-Agent is running.<br>";
                msg += "</span>";
                this.alert.error(msg);
            } else {
                this.alert.error(error);
            }
        });
    }

    set syncToolURL(url: string) {
        this.confStore.localSThg.URL = url;
        this.save();
    }

    set xdsAgentRetry(r: number) {
        this.confStore.localSThg.retry = r;
        this.confStore.xdsAgent.retry = r;
        this.save();
    }

    set xdsAgentUrl(url: string) {
        this.confStore.xdsAgent.URL = url;
        this.save();
    }


    set projectsRootDir(p: string) {
        if (p.charAt(0) === '~') {
            p = this.confStore.localSThg.tilde + p.substring(1);
        }
        this.confStore.projectsRootDir = p;
        this.save();
    }

    getLabelRootName(): string {
        let id = this.confStore.localSThg.ID;
        if (!id || id === "") {
            return null;
        }
        return id.slice(0, 15);
    }

    addProject(prj: IProject): Observable<IProject> {
        // Substitute tilde with to user home path
        let pathCli = prj.pathClient.trim();
        if (pathCli.charAt(0) === '~') {
            pathCli = this.confStore.localSThg.tilde + pathCli.substring(1);

            // Must be a full path (on Linux or Windows)
        } else if (!((pathCli.charAt(0) === '/') ||
            (pathCli.charAt(1) === ':' && (pathCli.charAt(2) === '\\' || pathCli.charAt(2) === '/')))) {
            pathCli = this.confStore.projectsRootDir + '/' + pathCli;
        }

        let xdsPrj: IXDSFolderConfig = {
            id: "",
            label: prj.label || "",
            path: pathCli,
            type: prj.type,
            defaultSdkID: prj.defaultSdkID,
            dataPathMap: {
                serverPath: prj.pathServer,
            },
            dataCloudSync: {
                syncThingID: this.confStore.localSThg.ID,
            }
        };
        // Send config to XDS server
        let newPrj = prj;
        return this.xdsServerSvr.addProject(xdsPrj)
            .flatMap(resStRemotePrj => {
                xdsPrj = resStRemotePrj;
                if (xdsPrj.type === ProjectType.SYNCTHING) {
                    // FIXME REWORK local ST config
                    //  move logic to server side tunneling-back by WS
                    let stData = xdsPrj.dataCloudSync;

                    // Now setup local config
                    let stLocPrj: ISyncThingProject = {
                        id: xdsPrj.id,
                        label: xdsPrj.label,
                        path: xdsPrj.path,
                        serverSyncThingID: stData.builderSThgID
                    };

                    // Set local Syncthing config
                    return this.stSvr.addProject(stLocPrj);

                } else {
                    return Observable.of(null);
                }
            })
            .map(resStLocalPrj => {
                this._addProject(xdsPrj);
                return newPrj;
            });
    }

    deleteProject(prj: IProject): Observable<IProject> {
        let idx = this._getProjectIdx(prj.id);
        let delPrj = prj;
        if (idx === -1) {
            throw new Error("Invalid project id (id=" + prj.id + ")");
        }
        return this.xdsServerSvr.deleteProject(prj.id)
            .flatMap(res => {
                if (prj.type === ProjectType.SYNCTHING) {
                    return this.stSvr.deleteProject(prj.id);
                }
                return Observable.of(null);
            })
            .map(res => {
                this.confStore.projects.splice(idx, 1);
                return delPrj;
            });
    }

    syncProject(prj: IProject): Observable<string> {
        let idx = this._getProjectIdx(prj.id);
        if (idx === -1) {
            throw new Error("Invalid project id (id=" + prj.id + ")");
        }
        return this.xdsServerSvr.syncProject(prj.id);
    }

    private _isUsableProject(p) {
        return p && p.isInSync &&
            (p.status === ProjectStatus.Enable) &&
            (p.status !== ProjectStatus.Syncing);
    }

    private _getProjectIdx(id: string): number {
        return this.confStore.projects.findIndex((item) => item.id === id);
    }

    private _addProject(rPrj: IXDSFolderConfig, noNext?: boolean) {

        // Convert XDSFolderConfig to IProject
        let pp: IProject = {
            id: rPrj.id,
            label: rPrj.label,
            pathClient: rPrj.path,
            pathServer: rPrj.dataPathMap.serverPath,
            type: rPrj.type,
            status: rPrj.status,
            isInSync: rPrj.isInSync,
            isUsable: this._isUsableProject(rPrj),
            defaultSdkID: rPrj.defaultSdkID,
            serverPrjDef: Object.assign({}, rPrj),  // do a copy
        };

        // add new project
        this.confStore.projects.push(pp);

        // sort project array
        this.confStore.projects.sort((a, b) => {
            if (a.label < b.label) {
                return -1;
            }
            if (a.label > b.label) {
                return 1;
            }
            return 0;
        });

        // FIXME: maybe reduce subject to only .project
        //this.confSubject.next(Object.assign({}, this.confStore).project);
        if (!noNext) {
            this.confSubject.next(Object.assign({}, this.confStore));
        }
    }
}
