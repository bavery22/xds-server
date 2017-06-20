package xdsconfig

import (
	"fmt"

	"os"

	"github.com/Sirupsen/logrus"
	"github.com/codegangsta/cli"
	"github.com/iotbzh/xds-server/lib/common"
)

// Config parameters (json format) of /config command
type Config struct {
	Version       string        `json:"version"`
	APIVersion    string        `json:"apiVersion"`
	VersionGitTag string        `json:"gitTag"`
	Builder       BuilderConfig `json:"builder"`
	Folders       FoldersConfig `json:"folders"`

	// Private (un-exported fields in REST GET /config route)
	FileConf FileConfig     `json:"-"`
	Log      *logrus.Logger `json:"-"`
}

// Config default values
const (
	DefaultAPIVersion = "1"
	DefaultPort       = "8000"
	DefaultShareDir   = "/mnt/share"
	DefaultSdkRootDir = "/xdt/sdk"
)

// Init loads the configuration on start-up
func Init(cliCtx *cli.Context, log *logrus.Logger) (*Config, error) {
	var err error

	// Define default configuration
	c := Config{
		Version:       cliCtx.App.Metadata["version"].(string),
		APIVersion:    DefaultAPIVersion,
		VersionGitTag: cliCtx.App.Metadata["git-tag"].(string),
		Builder:       BuilderConfig{},
		Folders:       FoldersConfig{},
		FileConf: FileConfig{
			WebAppDir:    "webapp/dist",
			ShareRootDir: DefaultShareDir,
			SdkRootDir:   DefaultSdkRootDir,
			HTTPPort:     DefaultPort,
		},
		Log: log,
	}

	// config file settings overwrite default config
	err = updateConfigFromFile(&c, cliCtx.GlobalString("config"))
	if err != nil {
		return nil, err
	}

	// Update location of shared dir if needed
	if !common.Exists(c.FileConf.ShareRootDir) {
		if err := os.MkdirAll(c.FileConf.ShareRootDir, 0770); err != nil {
			return nil, fmt.Errorf("No valid shared directory found: %v", err)
		}
	}
	c.Log.Infoln("Share root directory: ", c.FileConf.ShareRootDir)

	if c.FileConf.LogsDir != "" && !common.Exists(c.FileConf.LogsDir) {
		if err := os.MkdirAll(c.FileConf.LogsDir, 0770); err != nil {
			return nil, fmt.Errorf("Cannot create logs dir: %v", err)
		}
	}
	c.Log.Infoln("Logs directory: ", c.FileConf.LogsDir)

	return &c, nil
}
