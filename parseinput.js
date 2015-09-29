/** Parse sieve analysis input files.
 * Expected input files:
 * 	FASTA file with vaccine ID and AA sequence
 * 	FASTA file with breakthrough sequences and IDs
 * 	CSV with seqID:treatment (vaccine/placebo) treatment
 * 	CSV with sequence mismatches (relative to vaccine) for each seqID */

/** 2D-array (of chars) representing AAs at each position in the sequence
 * for the vaccine and each sequence ID */
var sequences_raw = [];
/** Object holding a 2D-array of sequences for both the vaccine and placebo groups */
var sequences = {"vaccine":[], "placebo":[]};
/** Dictionary with sequence IDs as keys and entries for:
 * 		AA sequence (char array),
 * 		distances (dictionary with array for each distance measure)
 * 		vaccine/placebo status (boolean) */
var seqID_lookup = {};
/** Object with vaccine ID and AA sequence */
var vaccine = {};
/** Array with conservation and reference info for each position */
var display_idx_map;
/* Lookup table with index for each hxb2 position*/
var refmap = {};
/** Number of people in the vaccine group */
var numvac = 0;
/** Number of people in the placebo group */
var numplac = 0;
/** Dictionary with wite-level statistics to display in navigation chart.
 * 	Entries are dictionaries for each distance measurement, within which are
 * 		entries that hold a site statistic and its array of values */
var siteStats = {/*EX: vxmatch_site:{placDist: [], vacDist: [], sieve_statistic: [], pval: [], qval: []}*/};
/** Appropriate scale for each of  */
var statScales = {};
/** Current distance metric, should eventually be changable through UI */
var dist_metric = "vxmatch_site"
/** Array of p-values */
var pvalues =[];
/** Array of absolute value of t-stats */
var tvalues =[];
/** Array of Entropy Values */
var entropies = {full:[],vaccine:[],placebo:[]};
/**  Object with nests of distances for each distance method */
var dists;

d3.csv("data/VTN502.trt.csv", function(assigndata)
{
	// eventually, get this from the filename
	studyname = "VTN502";
	parseTreatmentFile(assigndata);
	d3.text("data/VTN502.gag.MRK.fasta", function(fastadata)
	{
		// eventually, get this from the filename
		protein = "gag";
		doseqparsing(fastadata);
		d3.csv("data/VTN502.gag.MRK.vxmatch_site.distance.csv", function(distdata)
		{
			dodistparsing(distdata);
			d3.csv("data/VTN502.gag.MRK.vxmatch_site.results.csv", function(resultdata)
			{
				parseResultsFile(resultdata);
				
				// Transpose data for easier access
				sequences_raw = transpose(sequences_raw);
				sequences.vaccine = transpose(sequences.vaccine);
				sequences.placebo = transpose(sequences.placebo);
				// calculate entropies
				for(var i=0; i < sequences_raw.length; i++){
					entropies.full.push(jointentropy([i],sequences_raw,numvac+numplac).toFixed(2));
				}
				for(var i=0; i < sequences.vaccine.length; i++){
					entropies.vaccine.push(jointentropy([i],sequences.vaccine,numvac).toFixed(2));
				}
				for(var i=0; i < sequences.placebo.length; i++){
					entropies.placebo.push(jointentropy([i],sequences.placebo,numplac).toFixed(2));
				}
				// If loaded URL contains sites, add them to the current selection
				var urlSiteString = getParameterByName("sites");
				if (urlSiteString !== ""){
					// get sites identified by reference strand
					var urlSites = urlSiteString.split(",");
					// convert sites back to 0-based index
					//(our working index instead of the reference index)
					urlSites.forEach(function(d,i){
						urlSites[i] = refmap[urlSites[i]];
					})
					while(urlSites.length > 0){
						selected_sites.push(urlSites.pop());
					}
				}
				
				// Build the visualization
				generateVis();
					
			});
		});
	});	
});

function parseTreatmentFile(assigndata){
	seqID_lookup = d3.nest()
		.key(function(d) {return d.ptid;})
		.rollup(function(d) {
			if (d[0].treatment.toUpperCase().startsWith("P")){
				return { "distance": {}, "sequence": [], "vaccine": false };
			} else {
				return { "distance": {}, "sequence": [], "vaccine": true };
			}
		})
		.map(assigndata.filter(function(d){return !d.treatment.toLowerCase().startsWith("ref");}));
}

function doseqparsing(fastadata) {
	var fastaSequences = fastadata.split(/[;>]+/);
	for (var i = 0; i < fastaSequences.length; i++) {
		if (fastaSequences[i].length !== 0) {
			var seqID = fastaSequences[i].substring(0,fastaSequences[i].indexOf("\n")).trim(/[\n\r]/g, '');
			var seq = fastaSequences[i].substring(fastaSequences[i].indexOf("\n") + 1, fastaSequences[i].length);
			seq = seq.replace(/[\n\r]/g, '');
			seq = seq.split("");
			sequences_raw.push(seq);
			if (seqID.startsWith("reference"))
			{
				vaccine.ID = seqID.substring(seqID.lastIndexOf('|')+1, seqID.length);
				vaccine.sequence = seq;
			} else if ((seqID in seqID_lookup) && seqID_lookup[seqID].vaccine) {
				seqID_lookup[seqID].sequence = seq;
				sequences.vaccine.push(seq);
				numvac++;
			} else if (seqID in seqID_lookup) {
				seqID_lookup[seqID].sequence = seq;
				sequences.placebo.push(seq);
				numplac++;
			}
		}
	}
}

function dodistparsing(distdata)
{
	dists = d3.nest()
		.key(function(d) {return d.distance_method;})
		.rollup(function(data)
			{
				return d3.nest()
					.key(function(d) { return d.ptid; })
					.rollup(function(d) { return d.map(function(a) {return a.distance;}); })
					.entries(data);
			})
		.entries(distdata);
	display_idx_map = distdata.filter(function (d)
		{
			return d.ptid == distdata[0].ptid && d.distance_method == distdata[0].distance_method;
		}).map(function(d) {return d.display_position;});
	display_idx_map.forEach(function(d, i) {refmap[d] = i;});
}

function parseResultsFile(resultdata){
	
	var statsToDisplay = Object.keys(resultdata[0]).filter(function(d,i){ return i > 2; })
	siteStats = d3.nest()
		.key(function(d) {return d.distance_method;})
		.rollup(function(d){
			var result = {};
			for (var statidx in statsToDisplay){
				var stat = statsToDisplay[statidx];
				result[stat] = d.map(function(a){return +a[stat];});
			}
			return result;
		})
		.map(resultdata);
		
	var yScaleSelector = d3.select("#yscale_selector");
	statsToDisplay.forEach(function(d){
		var newOption = yScaleSelector.append("option")
			.attr("value", d)
			.attr("id","yscale-selection-option-" + d)
			.text(d);
		// hard coded for now. Will data always contain a pvalue?
		// answer is yes if we decide to build in a simple pval generator
		if (d === "pvalue"){ newOption.attr("selected","selected"); }
	})
		
	for (var metric in siteStats)
	{
		
		if (!(metric in statScales))
		{
			statScales[metric] = {}
		}
		for (var stat in siteStats[metric])
		{			
			//test if the stat name is some variant of
			//p-value or q-value
			if (/^[pq][\s-]?val/i.test(stat))
			{
				statScales[metric][stat] = d3.scale.linear()
					.domain([0, 1])
					.range([.95*height, 0]);
			} else {
				statScales[metric][stat] = d3.scale.linear()
					.range([0,.95*height]);
			}
		}
	}
}

/** Transpose 2D array */
function transpose(array) {
  return array[0].map(function (_, c) { return array.map(function (r) { return r[c]; }); });
}