var intervalStyle = new ol.style.Style({
                fill: new ol.style.Fill({
                    color: 'rgba(255, 100, 50, 0.3)'
                }),
                stroke: new ol.style.Stroke({
                    width: 2,
                    color: 'rgba(255, 100, 50, 0.8)'
				}),
				image: new ol.style.Circle({
                    fill: new ol.style.Fill({
                        color: 'rgba(55, 200, 150, 0.5)'
                    }),
                    stroke: new ol.style.Stroke({
                        width: 1,
                        color: 'rgba(55, 200, 150, 0.8)'
                    }),
                    radius: 7
                })
});

var otherStyle = new ol.style.Style({
                fill: new ol.style.Fill({
                    color: 'rgba(255, 0, 50, 0.3)'
                }),
                stroke: new ol.style.Stroke({
                    width: 2,
                    color: 'rgba(255, 0, 50, 0.8)'
				}),
				image: new ol.style.Circle({
                    fill: new ol.style.Fill({
                        color: 'rgba(255, 200, 50, 1)'
                    }),
                    stroke: new ol.style.Stroke({
                        width: 1,
                        color: 'rgba(255, 200, 50, 1)'
                    }),
                    radius: 5
                })
});

var customPointStyle = function(feature, resolution){
	if(feature.get('ReportType') == 'Interval')
		return [intervalStyle];
	else
		return [otherStyle];
}

var trackLayer = new ol.layer.Vector({
	source : new ol.source.GeoJSON({
		projection : 'EPSG:3857',
		url: 'data/01028269SKY959E/Line/all.geojson'
	}),
});

var pointsLayer = new ol.layer.Vector({
	source : new ol.source.GeoJSON({
		projection : 'EPSG:3857',
		url: 'data/01028269SKY959E/Point/all.geojson'
	}),
	style: customPointStyle
});

var map = new ol.Map({
    layers: [
        new ol.layer.Tile({
            source: new ol.source.OSM()
        }),
		trackLayer,
		pointsLayer
    ],
    renderer: 'canvas',
    target: 'map',
    controls: ol.control.defaults({
        attributionOptions: /** @type {olx.control.AttributionOptions} */ ({
            collapsible: false
        })
    }),
    view: new ol.View({
        center: [0, 0],
        zoom: 2
    })
});